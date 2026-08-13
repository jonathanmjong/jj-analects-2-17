import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
// Imported from source rather than the @proverbs/shared barrel so this suite doesn't depend on
// shared/dist having been rebuilt for a module that is still being wired into the barrel.
import {
  computeCapitalAllocation,
  type CapitalAllocationInput,
  type CapitalAllocationPillarKey,
  type CapitalAllocationReport,
} from "../../shared/src/capitalAllocation.js";

const YEARS = [2024, 2023, 2022, 2021, 2020];

function meta(fiscalYear: number) {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY" as const,
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
  };
}

function income(fiscalYear: number, overrides: Partial<IncomeStatement> = {}): IncomeStatement {
  return {
    ...meta(fiscalYear),
    revenue: 1000,
    costOfRevenue: null,
    grossProfit: 400,
    researchAndDevelopment: null,
    operatingIncome: 200,
    ebit: 200,
    ebitda: null,
    interestExpense: 25,
    pretaxIncome: 180,
    incomeTaxExpense: 36,
    netIncome: 144,
    eps: null,
    epsDiluted: 1.44,
    sharesOutstandingDiluted: 100,
    ...overrides,
  };
}

function balance(fiscalYear: number, overrides: Partial<BalanceSheet> = {}): BalanceSheet {
  return {
    ...meta(fiscalYear),
    cashAndEquivalents: 300,
    shortTermInvestments: null,
    receivables: 200,
    inventory: 150,
    totalCurrentAssets: 800,
    totalAssets: 2000,
    intangibleAssets: null,
    goodwill: null,
    totalCurrentLiabilities: 400,
    accountsPayable: 150,
    shortTermDebt: null,
    longTermDebt: 500,
    totalDebt: 500,
    totalLiabilities: 900,
    totalEquity: 800,
    tangibleBookValue: null,
    retainedEarnings: 600,
    ...overrides,
  };
}

function cashFlow(fiscalYear: number, overrides: Partial<CashFlowStatement> = {}): CashFlowStatement {
  return {
    ...meta(fiscalYear),
    operatingCashFlow: 580,
    capitalExpenditures: -80,
    freeCashFlow: 500,
    dividendsPaid: -100,
    stockBuybacks: -300,
    stockIssuance: 100,
    netDebtIssuance: 0,
    ...overrides,
  };
}

/** Flat five-year baseline: every level is constant, so any trend in a test came from that test's overrides. */
function input(overrides: Partial<CapitalAllocationInput> = {}): CapitalAllocationInput {
  return {
    income: YEARS.map((year) => income(year)),
    balance: YEARS.map((year) => balance(year)),
    cashFlow: YEARS.map((year) => cashFlow(year)),
    sector: "Industrials",
    ...overrides,
  };
}

function pillar(report: CapitalAllocationReport, key: CapitalAllocationPillarKey) {
  const found = report.pillars.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} pillar`);
  return found;
}

function point(report: CapitalAllocationReport, key: CapitalAllocationPillarKey, labelStartsWith: string) {
  return pillar(report, key).points.find((p) => p.label.startsWith(labelStartsWith));
}

describe("computeCapitalAllocation — balance-sheet trajectory", () => {
  it("reads net debt down over the window as improving", () => {
    // Debt 900 → 500 against constant cash 300: net debt 600 (FY2020) → 200 (FY2024).
    const debtByYear: Record<number, number> = { 2020: 900, 2021: 800, 2022: 700, 2023: 600, 2024: 500 };
    const report = computeCapitalAllocation(
      input({ balance: YEARS.map((year) => balance(year, { totalDebt: debtByYear[year] })) }),
    );

    const netDebt = point(report, "balanceSheet", "Net debt (");
    expect(netDebt?.value).toBe("$200, from $600 at FY2020");
    expect(netDebt?.trend).toBe("improving");
    expect(pillar(report, "balanceSheet").reading).toContain(
      "The company carries net debt of $200, down from $600 at FY2020",
    );
    expect(report.summary).toContain("Net debt falling");
  });

  it("reads net debt up over the window as deteriorating, and a small move as flat", () => {
    const rising = computeCapitalAllocation(
      input({
        balance: YEARS.map((year) => balance(year, { totalDebt: year === 2020 ? 400 : 900 })),
      }),
    );
    expect(point(rising, "balanceSheet", "Net debt (")?.trend).toBe("deteriorating");

    // 200 → 210 is a 4.8% move on the larger endpoint: inside the 10% band.
    const flat = computeCapitalAllocation(
      input({ balance: YEARS.map((year) => balance(year, { totalDebt: year === 2024 ? 510 : 500 })) }),
    );
    expect(point(flat, "balanceSheet", "Net debt (")?.trend).toBe("flat");
  });

  it("states a net cash position rather than negative net debt", () => {
    const report = computeCapitalAllocation(
      input({ balance: YEARS.map((year) => balance(year, { totalDebt: 100, cashAndEquivalents: 500 })) }),
    );
    expect(point(report, "balanceSheet", "Net debt (")?.value).toContain("net cash of $400");
    // No leverage multiple is offered against a net cash position.
    expect(point(report, "balanceSheet", "Net debt / operating income")).toBeUndefined();
  });

  it("computes the net debt / operating income proxy and labels the proxy honestly", () => {
    const report = computeCapitalAllocation(input());
    const leverage = point(report, "balanceSheet", "Net debt / operating income");
    // Net debt 200 / operating income 200.
    expect(leverage?.value).toContain("1.0x");
    expect(leverage?.label).toContain("no EBITDA line is reported");
  });

  it("computes interest coverage and its direction", () => {
    const report = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { operatingIncome: year === 2020 ? 100 : 200 })) }),
    );
    const coverage = point(report, "balanceSheet", "Interest coverage");
    // 200/25 = 8x now against 100/25 = 4x at FY2020.
    expect(coverage?.value).toBe("8.0x, from 4.0x at FY2020");
    expect(coverage?.trend).toBe("improving");
    expect(pillar(report, "balanceSheet").reading).toContain("covers interest 8.0 times");
  });

  it("withholds a coverage trend across a sign change, and says interest is not covered", () => {
    const report = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { operatingIncome: year === 2024 ? -50 : 200 })) }),
    );
    const coverage = point(report, "balanceSheet", "Interest coverage");
    expect(coverage?.value).toBe("operating income is negative — interest is not covered");
    expect(coverage?.trend).toBeUndefined();
  });

  it("suppresses the whole pillar for Financials with the reason", () => {
    const report = computeCapitalAllocation(input({ sector: "Financials" }));
    const balanceSheet = pillar(report, "balanceSheet");
    expect(balanceSheet.suppressed).toContain("raw material");
    expect(balanceSheet.points).toHaveLength(0);
    expect(report.summary).toContain("Leverage not read for this sector");
    // The other two pillars still read.
    expect(pillar(report, "reinvestment").points.length).toBeGreaterThan(0);
    expect(pillar(report, "distributions").points.length).toBeGreaterThan(0);
  });
});

describe("computeCapitalAllocation — reinvestment quality", () => {
  it("reads gross profits over total assets and its direction", () => {
    const report = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { grossProfit: year === 2020 ? 300 : 400 })) }),
    );
    const gp = point(report, "reinvestment", "Gross profits / total assets");
    // 400/2000 = 20% against 300/2000 = 15%.
    expect(gp?.value).toBe("20%, from 15% at FY2020");
    expect(gp?.trend).toBe("improving");
    expect(report.summary).toContain("gross profitability rising");
  });

  it("treats falling gross profitability as deteriorating and a half-point move as flat", () => {
    const falling = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { grossProfit: year === 2024 ? 300 : 400 })) }),
    );
    expect(point(falling, "reinvestment", "Gross profits / total assets")?.trend).toBe("deteriorating");

    // 400/2000 = 20.0% against 404/2000 = 20.2%: inside the 0.5pp band.
    const flat = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { grossProfit: year === 2020 ? 404 : 400 })) }),
    );
    expect(point(flat, "reinvestment", "Gross profits / total assets")?.trend).toBe("flat");
  });

  it("computes incremental return on new capital when the base grew enough", () => {
    // Invested capital 800+500-300 = 1000 at FY2020 → 1400+500-300 = 1600 at FY2024 (ΔIC 600, +60%).
    // NOPAT at a 20% effective rate: 100 × 0.8 = 80 → 200 × 0.8 = 160 (ΔNOPAT 80). 80/600 = 13%.
    const report = computeCapitalAllocation(
      input({
        income: YEARS.map((year) =>
          year === 2020
            ? income(year, { operatingIncome: 100, pretaxIncome: 80, incomeTaxExpense: 16 })
            : income(year),
        ),
        balance: YEARS.map((year) => balance(year, { totalEquity: year === 2020 ? 800 : 1400 })),
      }),
    );
    expect(point(report, "reinvestment", "Incremental return on new capital")?.value).toBe(
      "13% on $600 of capital added since FY2020",
    );
    expect(pillar(report, "reinvestment").reading).toContain("13% in after-tax operating profit");
  });

  it("omits the incremental figure when the reinvestment base barely moved", () => {
    // ΔIC of 100 on a 1000 base is 10% — below the 15% guard.
    const report = computeCapitalAllocation(
      input({ balance: YEARS.map((year) => balance(year, { totalEquity: year === 2024 ? 900 : 800 })) }),
    );
    const incremental = point(report, "reinvestment", "Incremental return on new capital");
    expect(incremental?.value).toContain("reinvestment base too small to measure");
    expect(incremental?.value).not.toContain("of capital added");
    expect(pillar(report, "reinvestment").reading).not.toContain("after-tax operating profit");
    // And no tax-rate assumption is disclosed, because nothing was computed with one.
    expect(point(report, "reinvestment", "Tax rate applied")).toBeUndefined();
  });

  it("omits the incremental figure when invested capital shrank", () => {
    const report = computeCapitalAllocation(
      input({ balance: YEARS.map((year) => balance(year, { totalEquity: year === 2024 ? 400 : 800 })) }),
    );
    expect(point(report, "reinvestment", "Incremental return on new capital")?.value).toContain(
      "reinvestment base too small to measure",
    );
  });

  it("clamps an effective tax rate above 50% and discloses the rate it used", () => {
    // Reported tax of 200 on pretax 180 is 111% — clamped to 50%, so NOPAT is 100 → 200 × 0.5.
    // ΔNOPAT = (200 × 0.5) − (100 × 0.5) = 50 over ΔIC 600 = 8.3%.
    const report = computeCapitalAllocation(
      input({
        income: YEARS.map((year) =>
          year === 2020
            ? income(year, { operatingIncome: 100, pretaxIncome: 90, incomeTaxExpense: 100 })
            : income(year, { incomeTaxExpense: 200 }),
        ),
        balance: YEARS.map((year) => balance(year, { totalEquity: year === 2020 ? 800 : 1400 })),
      }),
    );
    expect(point(report, "reinvestment", "Incremental return on new capital")?.value).toContain("8.3% on $600");
    expect(point(report, "reinvestment", "Tax rate applied")?.value).toBe("50%, from the FY2024 tax lines");
  });

  it("falls back to the 24% convention when the filings carry no usable tax lines", () => {
    // NOPAT 100 × 0.76 = 76 → 200 × 0.76 = 152; ΔNOPAT 76 over ΔIC 600 = 13%.
    const report = computeCapitalAllocation(
      input({
        income: YEARS.map((year) =>
          income(year, {
            operatingIncome: year === 2020 ? 100 : 200,
            pretaxIncome: null,
            incomeTaxExpense: null,
          }),
        ),
        balance: YEARS.map((year) => balance(year, { totalEquity: year === 2020 ? 800 : 1400 })),
      }),
    );
    expect(point(report, "reinvestment", "Incremental return on new capital")?.value).toContain("13% on $600");
    const taxPoint = point(report, "reinvestment", "Tax rate applied");
    expect(taxPoint?.value).toContain("24%");
    expect(taxPoint?.value).toContain("convention");
  });
});

describe("computeCapitalAllocation — shareholder distributions", () => {
  it("nets buybacks against issuance and expresses both against free cash flow", () => {
    const report = computeCapitalAllocation(input());
    // Buybacks 300 less issuance 100 = 200, on free cash flow of 500.
    expect(point(report, "distributions", "Buybacks net of issuance")?.value).toBe(
      "$200 in FY2024, 40% of free cash flow",
    );
    expect(point(report, "distributions", "Dividends paid")?.value).toBe("$100 in FY2024, 20% of free cash flow");
    expect(point(report, "distributions", "Dividends and net buybacks")?.value).toBe(
      "60% of $500 free cash flow",
    );
    expect(report.summary).toContain("distributions covered by free cash flow");
  });

  it("says so when issuance exceeded buybacks", () => {
    const report = computeCapitalAllocation(
      input({ cashFlow: YEARS.map((year) => cashFlow(year, { stockBuybacks: -50, stockIssuance: 200 })) }),
    );
    expect(point(report, "distributions", "Buybacks net of issuance")?.value).toBe(
      "net issuance of $150 in FY2024 — more stock was sold than bought back",
    );
    // Net issuance is not netted off the dividend, so distributions stay at the dividend alone.
    expect(point(report, "distributions", "Dividends and net buybacks")?.value).toBe("20% of $500 free cash flow");
  });

  it("labels the buyback line honestly when no issuance line is reported", () => {
    const report = computeCapitalAllocation(
      input({ cashFlow: YEARS.map((year) => cashFlow(year, { stockIssuance: null })) }),
    );
    expect(point(report, "distributions", "Buybacks (no stock issuance line is reported)")?.value).toBe(
      "$300 in FY2024, 60% of free cash flow",
    );
  });

  it("flags distributions running beyond free cash flow", () => {
    const report = computeCapitalAllocation(
      input({ cashFlow: YEARS.map((year) => cashFlow(year, { dividendsPaid: -600 })) }),
    );
    expect(point(report, "distributions", "Dividends paid")?.value).toBe("$600 in FY2024, 120% of free cash flow");
    expect(point(report, "distributions", "Dividends and net buybacks")?.value).toBe(
      "160% of $500 free cash flow — funded beyond free cash flow",
    );
    expect(report.summary).toContain("distributions funded beyond free cash flow");
  });

  it("handles negative free cash flow without printing a ratio against it", () => {
    const report = computeCapitalAllocation(
      input({
        cashFlow: YEARS.map((year) => cashFlow(year, { freeCashFlow: -200, operatingCashFlow: -120 })),
      }),
    );
    expect(point(report, "distributions", "Dividends paid")?.value).toBe(
      "$100 in FY2024, against negative free cash flow",
    );
    expect(point(report, "distributions", "Dividends and net buybacks")?.value).toContain(
      "funded beyond free cash flow",
    );
  });

  it("derives free cash flow from operating cash flow less capex when the line is missing", () => {
    const report = computeCapitalAllocation(
      input({
        cashFlow: YEARS.map((year) => cashFlow(year, { freeCashFlow: null, operatingCashFlow: 580, capitalExpenditures: -80 })),
      }),
    );
    expect(point(report, "distributions", "Dividends and net buybacks")?.value).toBe("60% of $500 free cash flow");
  });

  it("reads the diluted share count per year and cumulatively", () => {
    const sharesByYear: Record<number, number> = { 2020: 100, 2021: 95, 2022: 90, 2023: 85, 2024: 80 };
    const report = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { sharesOutstandingDiluted: sharesByYear[year] })) }),
    );
    // 80/100 over four years: 0.8^(1/4) − 1 = −5.4%/yr, −20% in total.
    const shares = point(report, "distributions", "Diluted share count");
    expect(shares?.value).toBe("-5.4%/yr, -20% in total since FY2020");
    expect(shares?.trend).toBe("improving");
    expect(report.summary).toContain("share count falling");
  });

  it("reads a rising share count as deteriorating", () => {
    const report = computeCapitalAllocation(
      input({ income: YEARS.map((year) => income(year, { sharesOutstandingDiluted: year === 2024 ? 120 : 100 })) }),
    );
    expect(point(report, "distributions", "Diluted share count")?.trend).toBe("deteriorating");
    expect(report.summary).toContain("share count rising");
  });

  it("reads a share count that barely moved as flat", () => {
    const report = computeCapitalAllocation(input());
    expect(point(report, "distributions", "Diluted share count")?.trend).toBe("flat");
  });
});

describe("computeCapitalAllocation — windowing, nulls and language", () => {
  it("measures over at most five fiscal years", () => {
    const years = [2024, 2023, 2022, 2021, 2020, 2019, 2018];
    const report = computeCapitalAllocation({
      income: years.map((year) => income(year)),
      balance: years.map((year) => balance(year, { totalDebt: year <= 2019 ? 2000 : 500 })),
      cashFlow: years.map((year) => cashFlow(year)),
      sector: "Industrials",
    });
    // FY2019's much larger debt is outside the window, so net debt reads flat against FY2020.
    expect(point(report, "balanceSheet", "Net debt (")?.value).toContain("at FY2020");
    expect(point(report, "balanceSheet", "Net debt (")?.trend).toBe("flat");
  });

  it("degrades to readings without points when no statements exist", () => {
    const report = computeCapitalAllocation({ income: [], balance: [], cashFlow: [], sector: null });
    expect(report.pillars.map((p) => p.key)).toEqual(["balanceSheet", "reinvestment", "distributions"]);
    for (const p of report.pillars) {
      expect(p.points).toHaveLength(0);
      expect(p.reading).toContain("not in the statements on file");
      expect(p.suppressed).toBeUndefined();
    }
    expect(report.summary).toBe("The statements on file do not carry enough to read capital allocation.");
  });

  it("drops only the points whose line items are missing", () => {
    const report = computeCapitalAllocation(
      input({
        balance: YEARS.map((year) => balance(year, { totalDebt: null, totalEquity: null })),
        income: YEARS.map((year) => income(year, { grossProfit: null, interestExpense: null })),
      }),
    );
    expect(point(report, "balanceSheet", "Net debt (")).toBeUndefined();
    expect(point(report, "balanceSheet", "Interest coverage")).toBeUndefined();
    expect(pillar(report, "balanceSheet").points).toHaveLength(0);
    expect(point(report, "reinvestment", "Gross profits / total assets")).toBeUndefined();
    // Distributions read from the cash flow statement, which is intact.
    expect(pillar(report, "distributions").points.length).toBeGreaterThan(0);
  });

  it("reads a single fiscal year without inventing a trend", () => {
    const report = computeCapitalAllocation({
      income: [income(2024)],
      balance: [balance(2024)],
      cashFlow: [cashFlow(2024)],
      sector: "Industrials",
    });
    const netDebt = point(report, "balanceSheet", "Net debt (");
    expect(netDebt?.value).toBe("$200");
    expect(netDebt?.trend).toBeUndefined();
    expect(point(report, "distributions", "Diluted share count")).toBeUndefined();
    expect(point(report, "reinvestment", "Incremental return on new capital")).toBeUndefined();
  });

  it("never emits a grade, a verdict token or more than two significant figures", () => {
    const report = computeCapitalAllocation(input());
    const text = [report.summary, ...report.pillars.flatMap((p) => [p.reading, ...p.points.map((pt) => pt.value)])].join(
      " ",
    );
    expect(text).not.toMatch(/exemplary|excellent|poor|strong|weak|grade [A-F]|\bA\+|\brating\b/i);
    // Two significant figures: no number carries a second decimal place.
    expect(text).not.toMatch(/\d+\.\d{2,}/);
  });
});
