import { formatCurrency, formatNumber } from "../../lib/utils";

export type StatementKind = "income" | "balance" | "cashFlow";

export type RowUnit = "currency" | "shares" | "perShare";

export interface RowConfig {
  /** Field name on the statement record. */
  key: string;
  label: string;
  /** 0 = subtotal / statement backbone, 1 = component line nested under the subtotal above it. */
  indent: 0 | 1;
  unit: RowUnit;
  /** Drop this row when the named row is present with identical values in every year — the SEC
   * EDGAR provider derives totalDebt straight from long-term debt, so the two rows are the same
   * numbers under two names for most companies. */
  dedupeAgainst?: string;
}

export interface StatementCell {
  fiscalYear: number;
  value: number | null;
}

export interface StatementRow extends RowConfig {
  cells: StatementCell[];
}

/** Only the shape these helpers actually need; the three statement interfaces all satisfy it. */
export interface StatementPeriod {
  fiscalYear: number;
}

/** ebitda and eps are null for every company in this dataset (never populated by either live
 * provider), so they are absent by design rather than rendered as empty rows. */
export const INCOME_ROWS: RowConfig[] = [
  { key: "revenue", label: "Revenue", indent: 0, unit: "currency" },
  { key: "costOfRevenue", label: "Cost of Revenue", indent: 1, unit: "currency" },
  { key: "grossProfit", label: "Gross Profit", indent: 0, unit: "currency" },
  { key: "researchAndDevelopment", label: "Research & Development", indent: 1, unit: "currency" },
  { key: "operatingIncome", label: "Operating Income", indent: 0, unit: "currency" },
  { key: "ebit", label: "EBIT", indent: 1, unit: "currency", dedupeAgainst: "operatingIncome" },
  { key: "interestExpense", label: "Interest Expense", indent: 1, unit: "currency" },
  { key: "pretaxIncome", label: "Pretax Income", indent: 0, unit: "currency" },
  { key: "incomeTaxExpense", label: "Income Tax Expense", indent: 1, unit: "currency" },
  { key: "netIncome", label: "Net Income", indent: 0, unit: "currency" },
  { key: "epsDiluted", label: "EPS (diluted)", indent: 1, unit: "perShare" },
  { key: "sharesOutstandingDiluted", label: "Diluted Shares", indent: 1, unit: "shares" },
];

/** shortTermDebt is null for every company here. totalDebt is long-term debt for most filers but
 * resolves to a broader basis for the minority whose XBRL only offers one (see
 * `BalanceSheet.totalDebt`), so the label no longer promises "long-term" for every company. */
export const BALANCE_ROWS: RowConfig[] = [
  { key: "cashAndEquivalents", label: "Cash & Equivalents", indent: 1, unit: "currency" },
  { key: "shortTermInvestments", label: "Short-Term Investments", indent: 1, unit: "currency" },
  { key: "receivables", label: "Receivables", indent: 1, unit: "currency" },
  { key: "inventory", label: "Inventory", indent: 1, unit: "currency" },
  { key: "totalCurrentAssets", label: "Total Current Assets", indent: 0, unit: "currency" },
  { key: "goodwill", label: "Goodwill", indent: 1, unit: "currency" },
  { key: "intangibleAssets", label: "Intangible Assets", indent: 1, unit: "currency" },
  { key: "totalAssets", label: "Total Assets", indent: 0, unit: "currency" },
  { key: "accountsPayable", label: "Accounts Payable", indent: 1, unit: "currency" },
  { key: "totalCurrentLiabilities", label: "Total Current Liabilities", indent: 0, unit: "currency" },
  { key: "totalDebt", label: "Debt", indent: 1, unit: "currency" },
  { key: "longTermDebt", label: "Long-Term Debt", indent: 1, unit: "currency", dedupeAgainst: "totalDebt" },
  { key: "totalLiabilities", label: "Total Liabilities", indent: 0, unit: "currency" },
  { key: "retainedEarnings", label: "Retained Earnings", indent: 1, unit: "currency" },
  { key: "totalEquity", label: "Total Equity", indent: 0, unit: "currency" },
  { key: "tangibleBookValue", label: "Tangible Book Value", indent: 1, unit: "currency" },
];

export const CASH_FLOW_ROWS: RowConfig[] = [
  { key: "operatingCashFlow", label: "Operating Cash Flow", indent: 0, unit: "currency" },
  { key: "depreciationAndAmortization", label: "Depreciation & Amortization", indent: 1, unit: "currency" },
  { key: "shareBasedCompensation", label: "Share-Based Compensation", indent: 1, unit: "currency" },
  { key: "capitalExpenditures", label: "Capital Expenditures", indent: 1, unit: "currency" },
  { key: "freeCashFlow", label: "Free Cash Flow", indent: 0, unit: "currency" },
  { key: "dividendsPaid", label: "Dividends Paid", indent: 1, unit: "currency" },
  { key: "stockBuybacks", label: "Share Buybacks", indent: 1, unit: "currency" },
  { key: "stockIssuance", label: "Stock Issuance", indent: 1, unit: "currency" },
  { key: "netDebtIssuance", label: "Net Debt Issuance", indent: 1, unit: "currency" },
];

export const STATEMENT_TABS: Array<{ kind: StatementKind; label: string; rows: RowConfig[] }> = [
  { kind: "income", label: "Income", rows: INCOME_ROWS },
  { kind: "balance", label: "Balance Sheet", rows: BALANCE_ROWS },
  { kind: "cashFlow", label: "Cash Flow", rows: CASH_FLOW_ROWS },
];

export function fiscalYearLabel(fiscalYear: number): string {
  return `FY${fiscalYear}`;
}

function numericField(period: StatementPeriod, key: string): number | null {
  const value = (period as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fiscal years present in the data, ascending so the table reads left-to-right chronologically. */
export function statementYears(periods: StatementPeriod[]): number[] {
  return [...new Set(periods.map((p) => p.fiscalYear))].sort((a, b) => a - b);
}

export function formatStatementValue(value: number | null, unit: RowUnit): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (unit === "shares") return `${formatNumber(value / 1_000_000, 1)}M`;
  if (unit === "perShare") return formatCurrency(value);
  return formatCurrency(value, { compact: true });
}

function sameCells(a: StatementCell[], b: StatementCell[]): boolean {
  return a.length === b.length && a.every((cell, idx) => cell.value === b[idx].value);
}

/** Curated rows for one statement: canonical order, one cell per fiscal year ascending, with
 * all-null rows and redundant aliases removed rather than shown as rows of dashes. */
export function buildStatementRows(periods: StatementPeriod[], configs: RowConfig[]): StatementRow[] {
  const years = statementYears(periods);
  const byYear = new Map(periods.map((p) => [p.fiscalYear, p]));

  const kept: StatementRow[] = [];
  for (const config of configs) {
    const cells = years.map((fiscalYear) => {
      const period = byYear.get(fiscalYear);
      return { fiscalYear, value: period ? numericField(period, config.key) : null };
    });
    if (cells.every((c) => c.value === null)) continue;
    if (config.dedupeAgainst) {
      const twin = kept.find((r) => r.key === config.dedupeAgainst);
      if (twin && sameCells(twin.cells, cells)) continue;
    }
    kept.push({ ...config, cells });
  }
  return kept;
}

export interface YoyChange {
  from: number;
  to: number;
  change: number;
}

/** Year-over-year change across the two most recent years with data. Returns null when a percentage
 * would be nonsense — zero base, or a sign flip (a swing from -$1B to +$1B is not "+200%"). */
export function computeYoyChange(cells: StatementCell[]): YoyChange | null {
  const withValues = cells.filter((c): c is { fiscalYear: number; value: number } => c.value !== null);
  if (withValues.length < 2) return null;
  const prev = withValues[withValues.length - 2];
  const last = withValues[withValues.length - 1];
  if (prev.value === 0) return null;
  if (Math.sign(prev.value) !== Math.sign(last.value)) return null;
  return {
    from: prev.fiscalYear,
    to: last.fiscalYear,
    change: (last.value - prev.value) / Math.abs(prev.value),
  };
}

export type RowTrend = "up" | "down" | "flat";

/** Direction from the first to the last populated year — deliberately not colored good/bad, since
 * a rising line is favourable for revenue and unfavourable for interest expense. */
export function rowTrend(cells: StatementCell[]): RowTrend | null {
  const values = cells.map((c) => c.value).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === last) return "flat";
  return last > first ? "up" : "down";
}

/** SVG polyline points for a row-level micro sparkline, normalized into a width x height box.
 * Null years are skipped (the line spans the years that do have data). */
export function sparklinePoints(cells: StatementCell[], width: number, height: number): string | null {
  const points = cells
    .map((c, idx) => ({ idx, value: c.value }))
    .filter((p): p is { idx: number; value: number } => p.value !== null);
  if (points.length < 2) return null;

  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min;
  const lastIdx = cells.length - 1 || 1;

  return points
    .map((p) => {
      const x = (p.idx / lastIdx) * width;
      const y = span === 0 ? height / 2 : height - ((p.value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export interface StatementGroup {
  /** The indent-0 subtotal this group is headed by, or null for components that appear before any. */
  parent: StatementRow | null;
  children: StatementRow[];
}

/**
 * Folds the flat row list into subtotal groups using the `indent` each config
 * already carries: an indent-0 row heads a group and the indent-1 rows after it
 * are its components. Rendering every line at once made the statements a wall of
 * 12-18 numbers where the subtotals — the figures most people actually read —
 * had no visual priority. Components with no preceding subtotal (possible if a
 * statement's first rows are all dropped as empty) become their own headless
 * group rather than being silently discarded.
 */
export function groupStatementRows(rows: StatementRow[]): StatementGroup[] {
  const groups: StatementGroup[] = [];
  for (const row of rows) {
    if (row.indent === 0 || groups.length === 0) {
      groups.push({ parent: row.indent === 0 ? row : null, children: row.indent === 0 ? [] : [row] });
      continue;
    }
    groups[groups.length - 1].children.push(row);
  }
  return groups;
}
