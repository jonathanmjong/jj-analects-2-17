import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
// Imported from source rather than the @proverbs/shared entry point so the suite does not
// depend on shared/dist having been rebuilt since valuation.ts was added.
import {
  assessPredictability,
  computeConsistency,
  computeReverseDcf,
  DEFAULT_TERMINAL_GROWTH,
  solveImpliedGrowth,
} from "../../shared/src/valuation.js";

function income(fiscalYear: number, revenue: number | null, shares: number | null): IncomeStatement {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    revenue,
    costOfRevenue: null,
    grossProfit: null,
    researchAndDevelopment: null,
    operatingIncome: null,
    ebit: null,
    ebitda: null,
    interestExpense: null,
    pretaxIncome: null,
    incomeTaxExpense: null,
    netIncome: null,
    eps: null,
    epsDiluted: null,
    sharesOutstandingDiluted: shares,
  };
}

function cash(fiscalYear: number, freeCashFlow: number | null): CashFlowStatement {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow,
    dividendsPaid: null,
    stockBuybacks: null,
    stockIssuance: null,
    netDebtIssuance: null,
  };
}

function sheet(fiscalYear: number, totalDebt: number | null, cashAndEquivalents: number | null): BalanceSheet {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    cashAndEquivalents,
    shortTermInvestments: null,
    receivables: null,
    inventory: null,
    totalCurrentAssets: null,
    totalAssets: null,
    intangibleAssets: null,
    goodwill: null,
    totalCurrentLiabilities: null,
    accountsPayable: null,
    shortTermDebt: null,
    longTermDebt: totalDebt,
    totalDebt,
    totalLiabilities: null,
    totalEquity: null,
    tangibleBookValue: null,
    retainedEarnings: null,
  };
}

/** Independent re-implementation of the DCF identity the solver inverts, so round-trip tests are not circular. */
function firmValue(growth: number, fcf0: number, discountRate: number, fadeYears: number, terminalGrowth: number): number {
  let fcf = fcf0;
  let pv = 0;
  for (let t = 1; t <= fadeYears; t++) {
    const g = fadeYears === 1 ? growth : growth + (terminalGrowth - growth) * ((t - 1) / (fadeYears - 1));
    fcf *= 1 + g;
    pv += fcf / (1 + discountRate) ** t;
  }
  return pv + (fcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth) / (1 + discountRate) ** fadeYears;
}

describe("solveImpliedGrowth", () => {
  it("recovers a hand-computed growth rate", () => {
    // One projected year then a Gordon terminal: EV = FCF0 * (1+g) * (1/1.1 + (1.02/0.08)/1.1) = 1250 * (1+g).
    // At g = 8% that is 1350, so a $1,350 one-share company must imply exactly 8%.
    const growth = solveImpliedGrowth({
      price: 1350,
      sharesOutstanding: 1,
      netDebt: 0,
      trailingFcf: 100,
      discountRate: 0.1,
      fadeYears: 1,
      terminalGrowth: 0.02,
    });
    expect(growth).toBeCloseTo(0.08, 6);
  });

  it("round-trips an arbitrary growth rate through the default 10-year fade", () => {
    const target = 0.14;
    const enterpriseValue = firmValue(target, 500, 0.1, 10, DEFAULT_TERMINAL_GROWTH);
    const growth = solveImpliedGrowth({
      price: (enterpriseValue - 2000) / 100,
      sharesOutstanding: 100,
      netDebt: 2000,
      trailingFcf: 500,
      discountRate: 0.1,
    });
    expect(growth).toBeCloseTo(target, 6);
  });

  it("implies higher growth as the price rises", () => {
    const base = { sharesOutstanding: 100, netDebt: 0, trailingFcf: 500, discountRate: 0.1 };
    const cheap = solveImpliedGrowth({ ...base, price: 80 });
    const dear = solveImpliedGrowth({ ...base, price: 120 });
    expect(cheap).not.toBeNull();
    expect(dear).not.toBeNull();
    expect(dear!).toBeGreaterThan(cheap!);
  });

  it("implies higher growth as the discount rate rises", () => {
    const base = { price: 100, sharesOutstanding: 100, netDebt: 0, trailingFcf: 500 };
    const low = solveImpliedGrowth({ ...base, discountRate: 0.08 });
    const high = solveImpliedGrowth({ ...base, discountRate: 0.12 });
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high!).toBeGreaterThan(low!);
  });

  it("returns null for non-positive trailing FCF, bad price/shares, and a discount rate at or below terminal growth", () => {
    const base = { price: 100, sharesOutstanding: 100, netDebt: 0, trailingFcf: 500, discountRate: 0.1 };
    expect(solveImpliedGrowth({ ...base, trailingFcf: -50 })).toBeNull();
    expect(solveImpliedGrowth({ ...base, trailingFcf: 0 })).toBeNull();
    expect(solveImpliedGrowth({ ...base, price: 0 })).toBeNull();
    expect(solveImpliedGrowth({ ...base, sharesOutstanding: 0 })).toBeNull();
    expect(solveImpliedGrowth({ ...base, discountRate: 0.02 })).toBeNull();
  });

  it("returns null rather than clamping when the price implies growth outside the solvable band", () => {
    const base = { sharesOutstanding: 100, netDebt: 0, trailingFcf: 100, discountRate: 0.1 };
    expect(solveImpliedGrowth({ ...base, price: 100000 })).toBeNull(); // needs far more than +60%
    expect(solveImpliedGrowth({ ...base, price: 0.01 })).toBeNull(); // needs far less than -50%
  });
});

describe("computeConsistency", () => {
  it("scores a steadily compounding series near zero", () => {
    const series = [2020, 2021, 2022, 2023, 2024].map((fiscalYear, idx) => ({
      fiscalYear,
      value: 10 * 1.12 ** idx,
    }));
    const { cv, usableYears } = computeConsistency(series);
    expect(usableYears).toBe(5);
    expect(cv).not.toBeNull();
    expect(cv!).toBeLessThan(0.01);
  });

  it("scores a series that jumps around its trend far higher", () => {
    const stable = computeConsistency(
      [2020, 2021, 2022, 2023, 2024].map((fiscalYear, idx) => ({ fiscalYear, value: 10 * 1.05 ** idx })),
    );
    const volatile = computeConsistency([
      { fiscalYear: 2020, value: 10 },
      { fiscalYear: 2021, value: 30 },
      { fiscalYear: 2022, value: 8 },
      { fiscalYear: 2023, value: 26 },
      { fiscalYear: 2024, value: 9 },
    ]);
    expect(volatile.cv).not.toBeNull();
    expect(volatile.cv!).toBeGreaterThan(0.4);
    expect(volatile.cv!).toBeGreaterThan(stable.cv!);
  });

  it("returns a null CV with fewer than four usable years", () => {
    expect(computeConsistency([
      { fiscalYear: 2022, value: 5 },
      { fiscalYear: 2023, value: 6 },
      { fiscalYear: 2024, value: 7 },
    ]).cv).toBeNull();
  });

  it("counts only positive, present values as usable", () => {
    const result = computeConsistency([
      { fiscalYear: 2020, value: -4 },
      { fiscalYear: 2021, value: null },
      { fiscalYear: 2022, value: 6 },
      { fiscalYear: 2023, value: 7 },
      { fiscalYear: 2024, value: 8 },
    ]);
    expect(result.usableYears).toBe(3);
    expect(result.cv).toBeNull();
  });
});

const STEADY_YEARS = [2020, 2021, 2022, 2023, 2024];
const steadyIncome = STEADY_YEARS.map((y, idx) => income(y, 1000 * 1.08 ** idx, 100)).reverse();
const steadyCashFlow = STEADY_YEARS.map((y, idx) => cash(y, 150 * 1.08 ** idx)).reverse();

describe("assessPredictability", () => {
  it("passes a business whose per-share revenue and FCF track their own trend", () => {
    const result = assessPredictability(steadyIncome, steadyCashFlow);
    expect(result.predictable).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.revenueCv!).toBeLessThan(0.05);
  });

  it("names revenue per share when it is the erratic series", () => {
    const erratic = [
      income(2024, 1000, 100),
      income(2023, 2600, 100),
      income(2022, 800, 100),
      income(2021, 3000, 100),
      income(2020, 1000, 100),
    ];
    const result = assessPredictability(erratic, steadyCashFlow);
    expect(result.predictable).toBe(false);
    expect(result.reason).toContain("revenue per share");
  });

  it("fails on too little usable history rather than guessing", () => {
    const result = assessPredictability(steadyIncome.slice(0, 3), steadyCashFlow.slice(0, 3));
    expect(result.predictable).toBe(false);
    expect(result.reason).toContain("too little usable history");
  });

  it("treats growth financed by share issuance as growth in neither series", () => {
    const dilutive = STEADY_YEARS.map((y, idx) => income(y, 1000 * 1.08 ** idx, 100 * 1.08 ** idx)).reverse();
    const result = assessPredictability(dilutive, steadyCashFlow);
    expect(result.revenueCv!).toBeLessThan(0.01); // flat per share, which the log-linear fit reads as a trend of zero
  });
});

describe("computeReverseDcf", () => {
  const okInput = {
    income: steadyIncome,
    balance: [sheet(2024, 500, 300)],
    cashFlow: steadyCashFlow,
    sector: "Technology",
    sharePrice: 40,
    sharesOutstanding: 100,
  };

  it("produces one implied growth rate per discount rate, rising with the discount rate", () => {
    const result = computeReverseDcf(okInput);
    expect(result.status).toBe("ok");
    expect(result.implied).toHaveLength(3);
    expect(result.implied![0].growth).toBeLessThan(result.implied![2].growth);
    expect(result.assumptions.netDebt).toBe(200);
    expect(result.assumptions.enterpriseValue).toBe(40 * 100 + 200);
  });

  it("suppresses financials and REITs with the sector reason", () => {
    for (const sector of ["Financials", "Real Estate"]) {
      const result = computeReverseDcf({ ...okInput, sector });
      expect(result.status).toBe("suppressed");
      expect(result.reason).toContain("not meaningful for financial companies / REITs");
    }
  });

  it("suppresses on non-positive trailing free cash flow", () => {
    const result = computeReverseDcf({
      ...okInput,
      cashFlow: STEADY_YEARS.map((y) => cash(y, -50)).reverse(),
    });
    expect(result.status).toBe("suppressed");
    expect(result.reason).toContain("negative");
    expect(result.implied).toBeUndefined();
  });

  it("suppresses an erratic business through the consistency gate", () => {
    const result = computeReverseDcf({
      ...okInput,
      cashFlow: [cash(2024, 150), cash(2023, 20), cash(2022, 400), cash(2021, 15), cash(2020, 300)],
    });
    expect(result.status).toBe("suppressed");
    expect(result.reason).toContain("free cash flow per share");
    expect(result.implied).toBeUndefined();
  });

  it("averages the last two years when the FCF base swings more than 40%", () => {
    const spiky = [cash(2024, 400), ...steadyCashFlow.slice(1)];
    const result = computeReverseDcf({ ...okInput, cashFlow: spiky });
    expect(result.assumptions.fcfBasis).toBe("average of the last two fiscal years");
    expect(result.assumptions.trailingFcf).toBeCloseTo((400 + 150 * 1.08 ** 3) / 2, 6);
    expect(result.assumptions.fcfBasisYears).toEqual([2023, 2024]);
  });

  it("keeps the latest fiscal year as the base when the two years agree", () => {
    const result = computeReverseDcf(okInput);
    expect(result.assumptions.fcfBasis).toBe("latest fiscal year");
    expect(result.assumptions.trailingFcf).toBeCloseTo(150 * 1.08 ** 4, 6);
  });

  it("labels realized growth windows as the windows they actually are", () => {
    const result = computeReverseDcf(okInput);
    expect(result.realized.map((w) => w.label)).toEqual(["3y (FY2021 → FY2024)", "4y (FY2020 → FY2024)"]);
    expect(result.realized[1].revenueCagr).toBeCloseTo(0.08, 6);
    expect(result.realized[1].fcfCagr).toBeCloseTo(0.08, 6);
  });

  it("still reports realized growth and assumptions when suppressed", () => {
    const result = computeReverseDcf({ ...okInput, sector: "Financials" });
    expect(result.realized).toHaveLength(2);
    expect(result.assumptions.fiscalYears).toEqual([2024, 2023, 2022, 2021, 2020]);
  });
});
