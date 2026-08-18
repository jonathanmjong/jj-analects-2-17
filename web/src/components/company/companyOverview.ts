import type { BalanceSheet, CashFlowStatement, Company, IncomeStatement } from "@proverbs/shared";
import { formatCurrency } from "../../lib/utils";

export interface OverviewRow {
  label: string;
  value: string;
  /** Set only for rows that link out to the underlying source. */
  href?: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * EDGAR stores the fiscal year end as MMDD ("0926"). Anything that isn't a well-formed
 * month-and-day returns null so the caller drops the row rather than printing a mangled date.
 */
export function formatFiscalYearEnd(mmdd: string | null | undefined): string | null {
  if (!mmdd || !/^\d{4}$/.test(mmdd)) return null;
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/**
 * A December fiscal year end needs no comment; anything else means the annual columns elsewhere on
 * the page cover a period offset from the calendar year, which changes how they compare to peers.
 */
export function isNonCalendarFiscalYearEnd(mmdd: string | null | undefined): boolean {
  return formatFiscalYearEnd(mmdd) !== null && mmdd?.slice(0, 2) !== "12";
}

export function edgarFilingsUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cik)}&type=10-K`;
}

/**
 * Identity rows, every one of them read straight off the company's SEC submissions record. Rows
 * whose field is absent are omitted rather than dashed: most company documents predate the
 * ingestion of the filer-identity fields and will carry only name, industry, country and CIK until
 * the fundamentals job next re-reads them.
 */
export function buildIdentityRows(company: Company): OverviewRow[] {
  const rows: OverviewRow[] = [];
  const push = (label: string, value: string | null | undefined, href?: string) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) rows.push(href ? { label, value: trimmed, href } : { label, value: trimmed });
  };

  push("Legal name", company.companyName);
  push("Industry classification", company.industry);
  push("Listed on", company.exchange);
  push("Headquarters", company.headquarters);
  push("Country", company.country);
  push("Incorporated in", company.stateOfIncorporation);
  push("Fiscal year end", formatFiscalYearEnd(company.fiscalYearEnd));
  push("Filer status", company.filerCategory);
  if (company.cik) push("CIK", company.cik, edgarFilingsUrl(company.cik));
  return rows;
}

/** The most recent fiscal year for which any of the three statements is on file. */
export function latestStatementYear(
  ...statementSets: Array<Array<{ fiscalYear: number }>>
): number | null {
  const years = statementSets.flat().map((s) => s.fiscalYear).filter((y) => typeof y === "number");
  return years.length > 0 ? Math.max(...years) : null;
}

/**
 * Deliberately matched on the exact fiscal year rather than taking each statement's first row: the
 * three statements can be filed to different depths, and pairing a FY2024 balance sheet with a
 * FY2025 income statement under one heading would misdate the figure.
 */
export function statementForYear<T extends { fiscalYear: number }>(
  statements: T[],
  fiscalYear: number | null,
): T | null {
  if (fiscalYear === null) return null;
  return statements.find((s) => s.fiscalYear === fiscalYear) ?? null;
}

export function buildScaleRows(input: {
  income: IncomeStatement | null;
  balance: BalanceSheet | null;
  cashFlow: CashFlowStatement | null;
  marketCap: number | null;
  /** True when market cap was derived from an SEC cover-page float rather than a live quote. */
  marketCapApproximate?: boolean;
}): OverviewRow[] {
  const rows: OverviewRow[] = [];
  const push = (label: string, value: number | null | undefined, prefix = "") => {
    if (value === null || value === undefined || Number.isNaN(value)) return;
    rows.push({ label, value: prefix + formatCurrency(value, { compact: true }) });
  };

  push("Revenue", input.income?.revenue);
  push("Net income", input.income?.netIncome);
  push("Free cash flow", input.cashFlow?.freeCashFlow);
  push("Total assets", input.balance?.totalAssets);
  push("Market cap", input.marketCap, input.marketCapApproximate ? "~" : "");
  return rows;
}

/** "#42 of 1,319 ranked companies", or null when this company was not ranked. */
export function formatRankLine(rank: number | null | undefined, peerCount: number | null | undefined): string | null {
  if (rank === null || rank === undefined) return null;
  if (!peerCount) return `#${rank.toLocaleString("en-US")}`;
  return `#${rank.toLocaleString("en-US")} of ${peerCount.toLocaleString("en-US")} ranked companies`;
}

/** "FY2025 · SEC EDGAR" — the period and source every figure in the scale half comes from. */
export function fiscalSourceLabel(fiscalYear: number | null): string {
  return fiscalYear === null ? "Latest annual filings · SEC EDGAR" : `FY${fiscalYear} · SEC EDGAR`;
}
