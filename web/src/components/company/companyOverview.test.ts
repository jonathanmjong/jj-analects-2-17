import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, Company, IncomeStatement } from "@proverbs/shared";
import {
  buildIdentityRows,
  buildScaleRows,
  edgarFilingsUrl,
  fiscalSourceLabel,
  formatFiscalYearEnd,
  formatRankLine,
  isNonCalendarFiscalYearEnd,
  latestStatementYear,
  statementForYear,
} from "./companyOverview";

function company(overrides: Partial<Company> = {}): Company {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    cik: "0000320193",
    sector: "Technology",
    industry: "Electronic Computers",
    description: null,
    website: null,
    country: "United States",
    isSp500: true,
    marketCapTier: "large",
    latest: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatFiscalYearEnd", () => {
  it("turns EDGAR's MMDD into a month-and-day label", () => {
    expect(formatFiscalYearEnd("0926")).toBe("September 26");
    expect(formatFiscalYearEnd("1231")).toBe("December 31");
    expect(formatFiscalYearEnd("0101")).toBe("January 1");
    expect(formatFiscalYearEnd("0229")).toBe("February 29");
  });

  it("returns null rather than a mangled date for anything malformed", () => {
    expect(formatFiscalYearEnd(null)).toBeNull();
    expect(formatFiscalYearEnd(undefined)).toBeNull();
    expect(formatFiscalYearEnd("")).toBeNull();
    expect(formatFiscalYearEnd("926")).toBeNull();
    expect(formatFiscalYearEnd("1331")).toBeNull();
    expect(formatFiscalYearEnd("0000")).toBeNull();
    expect(formatFiscalYearEnd("0festival")).toBeNull();
  });
});

describe("isNonCalendarFiscalYearEnd", () => {
  it("flags only a well-formed, non-December year end", () => {
    expect(isNonCalendarFiscalYearEnd("0926")).toBe(true);
    expect(isNonCalendarFiscalYearEnd("1231")).toBe(false);
    expect(isNonCalendarFiscalYearEnd("1201")).toBe(false);
    expect(isNonCalendarFiscalYearEnd(null)).toBe(false);
    expect(isNonCalendarFiscalYearEnd("nope")).toBe(false);
  });
});

describe("edgarFilingsUrl", () => {
  it("points at the filer's 10-K index", () => {
    expect(edgarFilingsUrl("0000320193")).toBe(
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K",
    );
  });
});

describe("buildIdentityRows", () => {
  it("renders every field a fully re-ingested company carries", () => {
    const rows = buildIdentityRows(
      company({
        exchange: "Nasdaq",
        headquarters: "Cupertino, CA",
        stateOfIncorporation: "CA",
        fiscalYearEnd: "0926",
        filerCategory: "Large accelerated filer",
      }),
    );
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Legal name", "Apple Inc."],
      ["Industry classification", "Electronic Computers"],
      ["Listed on", "Nasdaq"],
      ["Headquarters", "Cupertino, CA"],
      ["Country", "United States"],
      ["Incorporated in", "CA"],
      ["Fiscal year end", "September 26"],
      ["Filer status", "Large accelerated filer"],
      ["CIK", "0000320193"],
    ]);
    expect(rows.find((r) => r.label === "CIK")?.href).toContain("browse-edgar");
  });

  it("omits null rows entirely instead of printing dashes", () => {
    const rows = buildIdentityRows(company());
    expect(rows.map((r) => r.label)).toEqual(["Legal name", "Industry classification", "Country", "CIK"]);
    expect(rows.every((r) => r.value.length > 0)).toBe(true);
  });

  it("degrades to the pre-re-ingestion document shape without looking broken", () => {
    const rows = buildIdentityRows(company({ industry: null, country: null, cik: null }));
    expect(rows).toEqual([{ label: "Legal name", value: "Apple Inc." }]);
  });

  it("treats a whitespace-only field as absent", () => {
    const rows = buildIdentityRows(company({ exchange: "   ", filerCategory: "" }));
    expect(rows.map((r) => r.label)).not.toContain("Listed on");
    expect(rows.map((r) => r.label)).not.toContain("Filer status");
  });
});

describe("latestStatementYear / statementForYear", () => {
  it("takes the newest year present across all three statements", () => {
    expect(latestStatementYear([{ fiscalYear: 2023 }, { fiscalYear: 2025 }], [{ fiscalYear: 2024 }], [])).toBe(2025);
  });

  it("is null when nothing is on file", () => {
    expect(latestStatementYear([], [], [])).toBeNull();
  });

  it("never pairs a figure with a fiscal year it does not belong to", () => {
    const balance = [{ fiscalYear: 2024, totalAssets: 10 }];
    expect(statementForYear(balance, 2025)).toBeNull();
    expect(statementForYear(balance, 2024)).toBe(balance[0]);
    expect(statementForYear(balance, null)).toBeNull();
  });
});

describe("buildScaleRows", () => {
  const income = { revenue: 391_035_000_000, netIncome: 93_736_000_000 } as IncomeStatement;
  const balance = { totalAssets: 364_980_000_000 } as BalanceSheet;
  const cashFlow = { freeCashFlow: 108_807_000_000 } as CashFlowStatement;

  it("formats the latest-year figures compactly", () => {
    const rows = buildScaleRows({ income, balance, cashFlow, marketCap: 3_400_000_000_000 });
    expect(rows).toEqual([
      { label: "Revenue", value: "$391B" },
      { label: "Net income", value: "$93.7B" },
      { label: "Free cash flow", value: "$108.8B" },
      { label: "Total assets", value: "$365B" },
      { label: "Market cap", value: "$3.4T" },
    ]);
  });

  it("omits rows with no figure rather than dashing them", () => {
    const rows = buildScaleRows({
      income: { revenue: 100, netIncome: null } as IncomeStatement,
      balance: null,
      cashFlow: null,
      marketCap: null,
    });
    expect(rows.map((r) => r.label)).toEqual(["Revenue"]);
  });

  it("marks a market cap that came from a filing rather than a live quote", () => {
    const rows = buildScaleRows({
      income: null,
      balance: null,
      cashFlow: null,
      marketCap: 5_000_000_000,
      marketCapApproximate: true,
    });
    expect(rows).toEqual([{ label: "Market cap", value: "~$5B" }]);
  });
});

describe("formatRankLine", () => {
  it("states the rank against the size of the ranked universe", () => {
    expect(formatRankLine(42, 1319)).toBe("#42 of 1,319 ranked companies");
  });

  it("drops the denominator when the peer count is unknown", () => {
    expect(formatRankLine(42, null)).toBe("#42");
    expect(formatRankLine(42, 0)).toBe("#42");
  });

  it("is null for an unranked company", () => {
    expect(formatRankLine(null, 1319)).toBeNull();
    expect(formatRankLine(undefined, 1319)).toBeNull();
  });
});

describe("fiscalSourceLabel", () => {
  it("names the fiscal year and the source of the figures", () => {
    expect(fiscalSourceLabel(2025)).toBe("FY2025 · SEC EDGAR");
    expect(fiscalSourceLabel(null)).toBe("Latest annual filings · SEC EDGAR");
  });
});
