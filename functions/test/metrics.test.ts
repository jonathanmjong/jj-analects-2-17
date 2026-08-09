import { describe, expect, it } from "vitest";
import { cagr, safeDiv, coefficientOfVariation } from "../src/metrics/util.js";
import { roicOf, grossMarginOf } from "../src/metrics/periodMath.js";
import { growthCalculator } from "../src/metrics/calculators/growth.js";
import { piotroskiFScore } from "../src/metrics/calculators/earningsQuality.js";
import type { MetricInput } from "../src/metrics/types.js";
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

describe("piotroskiFScore", () => {
  function makeInput(current: PeriodFinancials, series: PeriodFinancials[]): MetricInput {
    return {
      ticker: "TEST",
      periodKey: "2024-FY",
      current,
      series,
      marketCap: null,
      enterpriseValue: null,
      sharePrice: null,
      sharesOutstanding: null,
      momentum: null,
    };
  }

  it("returns null when there is no prior-year period to compare against", () => {
    const current = makePeriod({});
    expect(piotroskiFScore(makeInput(current, [current]))).toBeNull();
  });

  it("scores 9/9 when every criterion improved year-over-year", () => {
    // Prior year is makePeriod's defaults: ROA=144/2000=0.072, currentRatio=500/300=1.667,
    // leverage=400/2000=0.2, grossMargin=400/1000=0.4, assetTurnover=1000/2000=0.5.
    const prior = makePeriod({});
    const current = makePeriod({
      revenue: 1100,
      costOfRevenue: 605,
      grossProfit: 495, // margin 0.45 > prior 0.4
      netIncome: 200, // ROA 0.10 > prior 0.072, and OCF(250) > netIncome(200)
      sharesOutstandingDiluted: 100, // <= prior 100, no new dilution
      totalCurrentAssets: 600,
      totalCurrentLiabilities: 300, // ratio 2.0 > prior 1.667
      longTermDebt: 300, // leverage 0.15 < prior 0.2
      totalAssets: 2000,
      operatingCashFlow: 250, // positive, and > netIncome
    });
    expect(piotroskiFScore(makeInput(current, [current, prior]))).toBe(9);
  });

  it("scores only the criteria that don't depend on the YoY comparison, when the prior year was better on every delta", () => {
    // This year matches the plain baseline fixture, compared against the "improving" fixture
    // (from the test above) as the better prior year — so every YoY-delta criterion (3, 5, 6, 8,
    // 9) should fail. But 4 of the 9 criteria are absolute checks on the current year alone, not
    // comparisons, and the baseline fixture still satisfies all of them:
    //  1. ROA > 0: baseline netIncome=144, totalAssets=2000 -> 0.072 > 0, true.
    //  2. OCF > 0: baseline operatingCashFlow=220 > 0, true.
    //  4. OCF > NetIncome (current year only, not a YoY delta): 220 > 144, true.
    //  7. No new dilution: baseline sharesOutstandingDiluted=100 <= prior year's 100 (equal
    //     counts as "no new shares issued"), true.
    // So the correct, deterministic result here is exactly 4 — this test exists to confirm the
    // calculator doesn't conflate "worse than a better comparison year" with "bad in absolute
    // terms," which would be a real bug if criteria 1/2/4/7 were miscoded as YoY comparisons.
    const betterPriorYear = makePeriod({
      revenue: 1100,
      costOfRevenue: 605,
      grossProfit: 495,
      netIncome: 200,
      sharesOutstandingDiluted: 100,
      totalCurrentAssets: 600,
      totalCurrentLiabilities: 300,
      longTermDebt: 300,
      totalAssets: 2000,
      operatingCashFlow: 250,
    });
    const worseCurrentYear = makePeriod({});
    const score = piotroskiFScore(makeInput(worseCurrentYear, [worseCurrentYear, betterPriorYear]));
    expect(score).toBe(4);
  });

  it("returns null when fewer than 6 of the 9 criteria are computable", () => {
    const sparsePrior = makePeriod({ totalAssets: null, totalCurrentAssets: null, totalCurrentLiabilities: null, longTermDebt: null });
    const sparseCurrent = makePeriod({ totalAssets: null, totalCurrentAssets: null, totalCurrentLiabilities: null, longTermDebt: null });
    expect(piotroskiFScore(makeInput(sparseCurrent, [sparseCurrent, sparsePrior]))).toBeNull();
  });
});
