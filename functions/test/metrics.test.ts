import { describe, expect, it } from "vitest";
import { cagr, safeDiv, coefficientOfVariation } from "../src/metrics/util.js";
import { roicOf, grossMarginOf } from "../src/metrics/periodMath.js";
import { growthCalculator } from "../src/metrics/calculators/growth.js";
import type { PeriodFinancials } from "../src/metrics/types.js";

function makePeriod(overrides: Partial<PeriodFinancials["income"] & PeriodFinancials["balance"] & PeriodFinancials["cashFlow"]>): PeriodFinancials {
  const base = {
    periodKey: "2024-FY",
    periodType: "FY" as const,
    fiscalYear: 2024,
    periodEnd: "2024-12-31",
    filedAt: null,
    sourceProvider: "test",
  };
  return {
    income: {
      ...base,
      revenue: 1000,
      costOfRevenue: 600,
      grossProfit: 400,
      researchAndDevelopment: null,
      operatingIncome: 200,
      ebit: 200,
      ebitda: 250,
      interestExpense: 20,
      pretaxIncome: 180,
      incomeTaxExpense: 36,
      netIncome: 144,
      eps: null,
      epsDiluted: 1.44,
      sharesOutstandingDiluted: 100,
      ...overrides,
    },
    balance: {
      ...base,
      cashAndEquivalents: 300,
      shortTermInvestments: null,
      receivables: 100,
      inventory: 80,
      totalCurrentAssets: 500,
      totalAssets: 2000,
      intangibleAssets: 50,
      goodwill: 100,
      totalCurrentLiabilities: 300,
      accountsPayable: 90,
      shortTermDebt: null,
      longTermDebt: 400,
      totalDebt: 400,
      totalLiabilities: 900,
      totalEquity: 1100,
      tangibleBookValue: 950,
      retainedEarnings: 500,
      ...overrides,
    },
    cashFlow: {
      ...base,
      operatingCashFlow: 220,
      capitalExpenditures: -50,
      freeCashFlow: 170,
      dividendsPaid: -30,
      stockBuybacks: -20,
      stockIssuance: 5,
      netDebtIssuance: null,
      ...overrides,
    },
  };
}

describe("safeDiv", () => {
  it("returns null on division by zero or missing operands", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(null, 5)).toBeNull();
    expect(safeDiv(10, 2)).toBe(5);
  });
});

describe("cagr", () => {
  it("computes annualized growth correctly", () => {
    expect(cagr(121, 100, 2)).toBeCloseTo(0.1, 5);
  });

  it("returns null for a non-positive starting value", () => {
    expect(cagr(100, -10, 2)).toBeNull();
    expect(cagr(100, 0, 2)).toBeNull();
  });
});

describe("coefficientOfVariation", () => {
  it("returns null when mean is zero", () => {
    expect(coefficientOfVariation([1, -1])).toBeNull();
  });
});

describe("roicOf", () => {
  it("computes NOPAT / invested capital using the implied tax rate", () => {
    const period = makePeriod({});
    // implied tax rate = 36/180 = 0.2, NOPAT = 200*0.8=160, investedCapital = 1100+400-300=1200
    expect(roicOf(period)).toBeCloseTo(160 / 1200, 5);
  });

  it("falls back to a 21% rate when pretax/tax data is unavailable", () => {
    const period = makePeriod({ pretaxIncome: null, incomeTaxExpense: null });
    expect(roicOf(period)).toBeCloseTo((200 * 0.79) / 1200, 5);
  });
});

describe("grossMarginOf", () => {
  it("divides gross profit by revenue", () => {
    expect(grossMarginOf(makePeriod({}))).toBeCloseTo(0.4, 5);
  });
});

describe("growthCalculator", () => {
  it("computes N-year CAGR from series[0] vs series[N]", () => {
    const recent = makePeriod({ revenue: 1210 });
    const yearAgo = makePeriod({ revenue: 1100 });
    const twoYearsAgo = makePeriod({ revenue: 1000 });
    const calc = growthCalculator("revenue", 1);
    const result = calc({
      ticker: "TEST",
      periodKey: "2024-FY",
      current: recent,
      series: [recent, yearAgo, twoYearsAgo],
      marketCap: null,
      enterpriseValue: null,
      sharePrice: null,
      sharesOutstanding: null,
    });
    expect(result).toBeCloseTo(0.1, 5);
  });

  it("returns null when the historical period is missing", () => {
    const recent = makePeriod({});
    const calc = growthCalculator("revenue", 3);
    const result = calc({
      ticker: "TEST",
      periodKey: "2024-FY",
      current: recent,
      series: [recent],
      marketCap: null,
      enterpriseValue: null,
      sharePrice: null,
      sharesOutstanding: null,
    });
    expect(result).toBeNull();
  });
});
