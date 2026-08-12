import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
// Imported from source rather than the @proverbs/shared barrel so this suite doesn't depend on
// shared/dist having been rebuilt for a module that is still being wired into the barrel.
import { computeForensicFlags, type ForensicInput, type ForensicReport } from "../../shared/src/forensics.js";

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
    interestExpense: 20,
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
    totalEquity: 1100,
    tangibleBookValue: null,
    retainedEarnings: 600,
    ...overrides,
  };
}

function cashFlow(fiscalYear: number, overrides: Partial<CashFlowStatement> = {}): CashFlowStatement {
  return {
    ...meta(fiscalYear),
    operatingCashFlow: 220,
    capitalExpenditures: -80,
    freeCashFlow: 140,
    dividendsPaid: -20,
    stockBuybacks: -30,
    stockIssuance: 5,
    netDebtIssuance: 0,
    ...overrides,
  };
}

/** Healthy three-year baseline: trips nothing, so any flag in a test came from that test's overrides. */
function baseline(overrides: Partial<ForensicInput> = {}): ForensicInput {
  return {
    income: [income(2024), income(2023), income(2022)],
    balance: [balance(2024), balance(2023), balance(2022)],
    cashFlow: [cashFlow(2024), cashFlow(2023), cashFlow(2022)],
    marketCap: 5000,
    sector: "Industrials",
    ...overrides,
  };
}

function keys(report: ForensicReport): string[] {
  return report.flags.map((f) => f.key);
}

function flag(report: ForensicReport, key: string) {
  return report.flags.find((f) => f.key === key);
}

describe("computeForensicFlags — baseline", () => {
  it("flags nothing on a healthy company and counts every check as evaluated", () => {
    const report = computeForensicFlags(baseline());
    expect(report.flags).toEqual([]);
    expect(report.suppressed).toEqual([]);
    expect(report.checkedCount).toBe(7);
  });
});

describe("Altman Z-Score", () => {
  it("matches a hand-computed distress case", () => {
    // X1 = (500-800)/1000 = -0.3, X2 = 50/1000 = 0.05, X3 = 20/1000 = 0.02,
    // X4 = 300/900 = 0.333..., X5 = 900/1000 = 0.9
    // Z = 1.2(-0.3) + 1.4(0.05) + 3.3(0.02) + 0.6(0.3333) + 1.0(0.9)
    //   = -0.36 + 0.07 + 0.066 + 0.2 + 0.9 = 0.876
    const report = computeForensicFlags(
      baseline({
        marketCap: 300,
        income: [income(2024, { revenue: 900, operatingIncome: 20, ebit: 20 }), income(2023), income(2022)],
        balance: [
          balance(2024, {
            totalCurrentAssets: 500,
            totalCurrentLiabilities: 800,
            totalAssets: 1000,
            totalLiabilities: 900,
            retainedEarnings: 50,
          }),
          balance(2023),
          balance(2022),
        ],
      }),
    );
    const z = flag(report, "altmanZ");
    expect(z?.severity).toBe("elevated");
    expect(z?.value).toBeCloseTo(0.876, 3);
    expect(z?.label).toBe("Balance-sheet distress indicators (Altman Z 0.9)");
  });

  it("marks the grey zone noteworthy and the safe zone unflagged", () => {
    // Z = 1.2(0.2) + 1.4(0.2) + 3.3(0.05) + 0.6(1000/1000) + 1.0(1.0) = 2.285
    const grey = computeForensicFlags(
      baseline({
        marketCap: 1000,
        income: [income(2024, { revenue: 1000, operatingIncome: 50, ebit: 50 }), income(2023), income(2022)],
        balance: [
          balance(2024, {
            totalCurrentAssets: 600,
            totalCurrentLiabilities: 400,
            totalAssets: 1000,
            totalLiabilities: 1000,
            retainedEarnings: 200,
          }),
          balance(2023),
          balance(2022),
        ],
      }),
    );
    expect(flag(grey, "altmanZ")?.severity).toBe("noteworthy");
    expect(flag(grey, "altmanZ")?.value).toBeCloseTo(2.285, 3);

    // The healthy baseline sits well above 2.99.
    expect(keys(computeForensicFlags(baseline()))).not.toContain("altmanZ");
  });

  it("uses ebit when operatingIncome is null", () => {
    const withEbitOnly = computeForensicFlags(
      baseline({
        marketCap: 300,
        income: [income(2024, { revenue: 900, operatingIncome: null, ebit: 20 }), income(2023), income(2022)],
        balance: [
          balance(2024, {
            totalCurrentAssets: 500,
            totalCurrentLiabilities: 800,
            totalAssets: 1000,
            totalLiabilities: 900,
            retainedEarnings: 50,
          }),
          balance(2023),
          balance(2022),
        ],
      }),
    );
    expect(flag(withEbitOnly, "altmanZ")?.value).toBeCloseTo(0.876, 3);
  });

  it("skips the check without a market cap, without flagging", () => {
    const report = computeForensicFlags(baseline({ marketCap: null }));
    expect(keys(report)).not.toContain("altmanZ");
    expect(report.suppressed).toEqual([]);
    expect(report.checkedCount).toBe(6);
  });
});

describe("sector suppression", () => {
  for (const sector of ["Financials", "Real Estate"]) {
    it(`suppresses the model-based checks for ${sector} with a reason`, () => {
      // Inputs that would otherwise trip Altman hard.
      const report = computeForensicFlags(
        baseline({
          sector,
          marketCap: 300,
          balance: [
            balance(2024, {
              totalCurrentAssets: 500,
              totalCurrentLiabilities: 800,
              totalAssets: 1000,
              totalLiabilities: 900,
              retainedEarnings: 50,
            }),
            balance(2023),
            balance(2022),
          ],
        }),
      );
      expect(keys(report)).not.toContain("altmanZ");
      expect(keys(report)).not.toContain("earningsQualityIndex");
      expect(report.suppressed).toEqual([
        { key: "altmanZ", reason: `not applicable to ${sector}` },
        { key: "earningsQualityIndex", reason: `not applicable to ${sector}` },
      ]);
      expect(report.checkedCount).toBe(5);
    });
  }

  it("runs every check for a sector the models do apply to", () => {
    expect(computeForensicFlags(baseline({ sector: "Technology" })).suppressed).toEqual([]);
  });
});

describe("accrual divergence", () => {
  it("flags net income rising while operating cash flow falls", () => {
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { netIncome: 200 }), income(2023, { netIncome: 150 }), income(2022)],
        cashFlow: [cashFlow(2024, { operatingCashFlow: 190 }), cashFlow(2023, { operatingCashFlow: 240 }), cashFlow(2022)],
      }),
    );
    expect(flag(report, "accrualDivergence")?.severity).toBe("noteworthy");
  });

  it("flags an accrual ratio above 10% of total assets as elevated", () => {
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { netIncome: 400 }), income(2023), income(2022)],
        cashFlow: [cashFlow(2024, { operatingCashFlow: 100 }), cashFlow(2023), cashFlow(2022)],
      }),
    );
    const f = flag(report, "accrualDivergence");
    expect(f?.severity).toBe("elevated");
    expect(f?.value).toBeCloseTo(0.15, 5);
  });

  it("does not flag when income and cash flow move together", () => {
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { netIncome: 200 }), income(2023, { netIncome: 150 }), income(2022)],
        cashFlow: [cashFlow(2024, { operatingCashFlow: 260 }), cashFlow(2023, { operatingCashFlow: 240 }), cashFlow(2022)],
      }),
    );
    expect(keys(report)).not.toContain("accrualDivergence");
  });
});

describe("receivables versus revenue", () => {
  it("flags a 15–30pp gap as noteworthy and a wider one as elevated", () => {
    const noteworthy = computeForensicFlags(
      baseline({
        balance: [balance(2024, { receivables: 240 }), balance(2023, { receivables: 200 }), balance(2022)],
        income: [income(2024, { revenue: 1000 }), income(2023, { revenue: 1000 }), income(2022)],
      }),
    );
    const f = flag(noteworthy, "receivablesVsRevenue");
    expect(f?.severity).toBe("noteworthy");
    expect(f?.value).toBeCloseTo(20, 5);

    const elevated = computeForensicFlags(
      baseline({
        balance: [balance(2024, { receivables: 280 }), balance(2023, { receivables: 200 }), balance(2022)],
        income: [income(2024, { revenue: 1000 }), income(2023, { revenue: 1000 }), income(2022)],
      }),
    );
    expect(flag(elevated, "receivablesVsRevenue")?.severity).toBe("elevated");
  });

  it("does not flag when receivables track revenue", () => {
    const report = computeForensicFlags(
      baseline({
        balance: [balance(2024, { receivables: 220 }), balance(2023, { receivables: 200 }), balance(2022)],
        income: [income(2024, { revenue: 1100 }), income(2023, { revenue: 1000 }), income(2022)],
      }),
    );
    expect(keys(report)).not.toContain("receivablesVsRevenue");
  });
});

describe("inventory build", () => {
  it("flags inventory growing well ahead of revenue", () => {
    const report = computeForensicFlags(
      baseline({
        balance: [balance(2024, { inventory: 210 }), balance(2023, { inventory: 150 }), balance(2022)],
        income: [income(2024, { revenue: 1000 }), income(2023, { revenue: 1000 }), income(2022)],
      }),
    );
    const f = flag(report, "inventoryBuild");
    expect(f?.severity).toBe("elevated");
    expect(f?.value).toBeCloseTo(40, 5);
  });

  it("skips the check entirely for a company carrying no inventory", () => {
    const report = computeForensicFlags(
      baseline({
        balance: [balance(2024, { inventory: 0 }), balance(2023, { inventory: 0 }), balance(2022, { inventory: 0 })],
      }),
    );
    expect(keys(report)).not.toContain("inventoryBuild");
    expect(report.checkedCount).toBe(6);
  });

  it("skips the check when inventory is null", () => {
    const report = computeForensicFlags(
      baseline({
        balance: [
          balance(2024, { inventory: null }),
          balance(2023, { inventory: null }),
          balance(2022, { inventory: null }),
        ],
      }),
    );
    expect(keys(report)).not.toContain("inventoryBuild");
    expect(report.checkedCount).toBe(6);
  });
});

describe("gross-margin erosion", () => {
  it("flags a one-year decline beyond 300bps", () => {
    // 40% -> 36% = 400bps.
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { grossProfit: 360 }), income(2023, { grossProfit: 400 }), income(2022, { grossProfit: 400 })],
      }),
    );
    const f = flag(report, "grossMarginErosion");
    expect(f?.severity).toBe("noteworthy");
    expect(f?.value).toBeCloseTo(400, 5);
  });

  it("flags a two-year decline beyond 500bps even when each single year is mild", () => {
    // 42% -> 39% -> 36%: 300bps latest year (not > 300), 600bps over two years.
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { grossProfit: 360 }), income(2023, { grossProfit: 390 }), income(2022, { grossProfit: 420 })],
      }),
    );
    const f = flag(report, "grossMarginErosion");
    expect(f?.severity).toBe("noteworthy");
    expect(f?.value).toBeCloseTo(600, 5);
  });

  it("escalates a one-year decline beyond 500bps", () => {
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { grossProfit: 330 }), income(2023, { grossProfit: 400 }), income(2022, { grossProfit: 400 })],
      }),
    );
    expect(flag(report, "grossMarginErosion")?.severity).toBe("elevated");
  });

  it("does not flag a stable or improving margin", () => {
    const report = computeForensicFlags(
      baseline({
        income: [income(2024, { grossProfit: 420 }), income(2023, { grossProfit: 400 }), income(2022, { grossProfit: 400 })],
      }),
    );
    expect(keys(report)).not.toContain("grossMarginErosion");
  });
});

describe("rising share count", () => {
  it("flags 2–5% dilution as noteworthy", () => {
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { sharesOutstandingDiluted: 103 }),
          income(2023, { sharesOutstandingDiluted: 100 }),
          income(2022),
        ],
      }),
    );
    const f = flag(report, "shareCountGrowth");
    expect(f?.severity).toBe("noteworthy");
    expect(f?.label).toBe("Shareholders being diluted");
    expect(f?.value).toBeCloseTo(3, 5);
  });

  it("flags dilution beyond 5% as elevated", () => {
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { sharesOutstandingDiluted: 108 }),
          income(2023, { sharesOutstandingDiluted: 100 }),
          income(2022),
        ],
      }),
    );
    expect(flag(report, "shareCountGrowth")?.severity).toBe("elevated");
  });

  it("does not flag a shrinking share count", () => {
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { sharesOutstandingDiluted: 95 }),
          income(2023, { sharesOutstandingDiluted: 100 }),
          income(2022),
        ],
      }),
    );
    expect(keys(report)).not.toContain("shareCountGrowth");
  });
});

describe("partial earnings-quality index", () => {
  it("stays quiet when only one component is elevated", () => {
    // Fast sales growth alone (SGI 1.5) with everything else neutral.
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { revenue: 1500, grossProfit: 600 }),
          income(2023, { revenue: 1000, grossProfit: 400 }),
          income(2022),
        ],
        balance: [balance(2024, { receivables: 300 }), balance(2023, { receivables: 200 }), balance(2022)],
      }),
    );
    expect(keys(report)).not.toContain("earningsQualityIndex");
  });

  it("fires only on a clearly elevated combination, and never above noteworthy", () => {
    // Receivable days stretching (DSRI ~1.6), sales up 50% (SGI 1.5), margin softening
    // (GMI ~1.15) and heavy accruals (TATA 0.15) all at once.
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { revenue: 1500, grossProfit: 525, netIncome: 400 }),
          income(2023, { revenue: 1000, grossProfit: 400, netIncome: 150 }),
          income(2022),
        ],
        balance: [balance(2024, { receivables: 480 }), balance(2023, { receivables: 200 }), balance(2022)],
        cashFlow: [cashFlow(2024, { operatingCashFlow: 100 }), cashFlow(2023), cashFlow(2022)],
      }),
    );
    const f = flag(report, "earningsQualityIndex");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("noteworthy");
    expect(f?.detail).toContain("5 of 8 components");
  });

  it("never uses accusatory wording", () => {
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { revenue: 1500, grossProfit: 525, netIncome: 400 }),
          income(2023, { revenue: 1000, grossProfit: 400, netIncome: 150 }),
          income(2022),
        ],
        balance: [balance(2024, { receivables: 480 }), balance(2023, { receivables: 200 }), balance(2022)],
        cashFlow: [cashFlow(2024, { operatingCashFlow: 100 }), cashFlow(2023), cashFlow(2022)],
      }),
    );
    const prose = report.flags.map((f) => `${f.label} ${f.detail}`).join(" ").toLowerCase();
    expect(prose).not.toContain("manipulat");
    expect(prose).not.toContain("fraud");
  });
});

describe("null tolerance", () => {
  it("returns no flags and a zero checked count when every line item is null", () => {
    const nullIncome = (year: number) =>
      income(year, {
        revenue: null,
        grossProfit: null,
        operatingIncome: null,
        ebit: null,
        netIncome: null,
        sharesOutstandingDiluted: null,
      });
    const nullBalance = (year: number) =>
      balance(year, {
        receivables: null,
        inventory: null,
        totalCurrentAssets: null,
        totalCurrentLiabilities: null,
        totalAssets: null,
        totalLiabilities: null,
        retainedEarnings: null,
      });
    const nullCashFlow = (year: number) => cashFlow(year, { operatingCashFlow: null });

    const report = computeForensicFlags({
      income: [nullIncome(2024), nullIncome(2023), nullIncome(2022)],
      balance: [nullBalance(2024), nullBalance(2023), nullBalance(2022)],
      cashFlow: [nullCashFlow(2024), nullCashFlow(2023), nullCashFlow(2022)],
      marketCap: null,
      sector: "Industrials",
    });
    expect(report.flags).toEqual([]);
    expect(report.checkedCount).toBe(0);
  });

  it("handles empty statement arrays", () => {
    const report = computeForensicFlags({ income: [], balance: [], cashFlow: [], marketCap: null, sector: null });
    expect(report).toEqual({ flags: [], suppressed: [], checkedCount: 0 });
  });

  it("still evaluates the checks a single prior year supports", () => {
    const report = computeForensicFlags({
      income: [income(2024, { sharesOutstandingDiluted: 110 }), income(2023, { sharesOutstandingDiluted: 100 })],
      balance: [],
      cashFlow: [],
      marketCap: 5000,
      sector: "Industrials",
    });
    expect(keys(report)).toEqual(["shareCountGrowth"]);
    expect(report.checkedCount).toBe(2); // share count and gross margin
  });
});

describe("report ordering", () => {
  it("lists elevated flags before noteworthy ones", () => {
    const report = computeForensicFlags(
      baseline({
        income: [
          income(2024, { sharesOutstandingDiluted: 103, grossProfit: 330 }),
          income(2023, { sharesOutstandingDiluted: 100, grossProfit: 400 }),
          income(2022, { grossProfit: 400 }),
        ],
      }),
    );
    expect(report.flags.map((f) => f.severity)).toEqual(["elevated", "noteworthy"]);
  });
});
