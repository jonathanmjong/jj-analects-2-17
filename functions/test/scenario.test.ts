import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
// Imported from source rather than the @proverbs/shared entry point so the suite does not
// depend on shared/dist having been rebuilt since scenario.ts was added.
import { DEFAULT_EFFECTIVE_TAX_RATE } from "../../shared/src/capitalAllocation.js";
import {
  computeGrowthRoicSeries,
  computeScenario,
  dominantDriver,
  effectiveTaxRate,
  EXIT_PE_FALLBACK,
  returnOnInvestedCapital,
  scenarioDefaults,
  type ScenarioInput,
} from "../../shared/src/scenario.js";

function income(
  fiscalYear: number,
  fields: Partial<IncomeStatement> = {},
): IncomeStatement {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    revenue: null,
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
    sharesOutstandingDiluted: null,
    ...fields,
  };
}

function sheet(fiscalYear: number, fields: Partial<BalanceSheet> = {}): BalanceSheet {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    cashAndEquivalents: null,
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
    longTermDebt: null,
    totalDebt: null,
    totalLiabilities: null,
    totalEquity: null,
    tangibleBookValue: null,
    retainedEarnings: null,
    ...fields,
  };
}

function cash(fiscalYear: number, fields: Partial<CashFlowStatement> = {}): CashFlowStatement {
  return {
    periodKey: `${fiscalYear}-FY`,
    periodType: "FY",
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    filedAt: null,
    sourceProvider: "test",
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow: null,
    dividendsPaid: null,
    stockBuybacks: null,
    stockIssuance: null,
    netDebtIssuance: null,
    ...fields,
  };
}

const BASE: ScenarioInput = {
  revenueBase: 1000,
  sharesOutstanding: 100,
  sharePrice: 20,
  growthRate: 0.1,
  operatingMargin: 0.2,
  exitPe: 15,
  years: 5,
  taxRate: 0.25,
};

describe("computeScenario", () => {
  it("reproduces a hand-computed round trip", () => {
    const result = computeScenario(BASE);

    // 1000 × 1.1^5 = 1610.51 revenue → ×20% margin → ×(1−25% tax) = 241.5765 net income
    // → ÷100 shares = 2.415765 EPS → ×15 = $36.236475 → (36.236475/20)^(1/5) − 1.
    expect(result.status).toBe("ok");
    expect(result.reason).toBeNull();
    expect(result.terminalRevenue).toBeCloseTo(1610.51, 6);
    expect(result.terminalEps).toBeCloseTo(2.415765, 9);
    expect(result.impliedPrice).toBeCloseTo(36.236475, 9);
    expect(result.annualizedReturn).toBeCloseTo(0.12622, 5);
  });

  it("defaults to a 5-year horizon and the conventional tax rate", () => {
    const { years: _years, taxRate: _taxRate, ...rest } = BASE;
    const result = computeScenario(rest);

    expect(result.terminalRevenue).toBeCloseTo(1610.51, 6);
    expect(result.terminalEps).toBeCloseTo((1610.51 * 0.2 * (1 - DEFAULT_EFFECTIVE_TAX_RATE)) / 100, 6);
  });

  it("clamps a tax rate above the allowed band before taxing terminal earnings", () => {
    const clamped = computeScenario({ ...BASE, taxRate: 0.9 });
    const atLimit = computeScenario({ ...BASE, taxRate: 0.5 });

    expect(clamped.terminalEps).toBeCloseTo(atLimit.terminalEps!, 12);
    expect(clamped.terminalEps).toBeCloseTo((1610.51 * 0.2 * 0.5) / 100, 6);
  });

  it("clamps a negative tax rate up to zero", () => {
    const clamped = computeScenario({ ...BASE, taxRate: -0.4 });

    expect(clamped.terminalEps).toBeCloseTo((1610.51 * 0.2) / 100, 6);
  });

  it("returns a reason and no numbers on unusable inputs", () => {
    const cases: Array<Partial<ScenarioInput>> = [
      { revenueBase: 0 },
      { revenueBase: Number.NaN },
      { sharesOutstanding: 0 },
      { sharePrice: 0 },
      { growthRate: -1 },
      { operatingMargin: -0.05 },
      { exitPe: 0 },
      { years: 0 },
    ];

    for (const override of cases) {
      const result = computeScenario({ ...BASE, ...override });
      expect(result.status, JSON.stringify(override)).toBe("unavailable");
      expect(result.reason).not.toBeNull();
      expect(result.impliedPrice).toBeNull();
      expect(result.annualizedReturn).toBeNull();
      expect(result.terminalRevenue).toBeNull();
      expect(result.terminalEps).toBeNull();
    }
  });
});

describe("effectiveTaxRate", () => {
  it("uses the filer's own rate when it is meaningful", () => {
    expect(effectiveTaxRate(income(2024, { incomeTaxExpense: 21, pretaxIncome: 100 }))).toBeCloseTo(0.21, 12);
  });

  it("clamps outliers into the allowed band", () => {
    expect(effectiveTaxRate(income(2024, { incomeTaxExpense: 90, pretaxIncome: 100 }))).toBe(0.5);
    expect(effectiveTaxRate(income(2024, { incomeTaxExpense: -10, pretaxIncome: 100 }))).toBe(0);
  });

  it("falls back to the convention on a loss year or a missing tax line", () => {
    expect(effectiveTaxRate(income(2024, { incomeTaxExpense: 5, pretaxIncome: -100 }))).toBe(DEFAULT_EFFECTIVE_TAX_RATE);
    expect(effectiveTaxRate(income(2024, { pretaxIncome: 100 }))).toBe(DEFAULT_EFFECTIVE_TAX_RATE);
  });
});

describe("returnOnInvestedCapital", () => {
  it("computes NOPAT over equity plus debt less cash", () => {
    const observation = returnOnInvestedCapital(
      income(2024, { operatingIncome: 120, incomeTaxExpense: 25, pretaxIncome: 100 }),
      sheet(2024, { totalEquity: 500, totalDebt: 200, cashAndEquivalents: 100, totalAssets: 1000 }),
    );

    expect(observation.guard).toBeNull();
    expect(observation.investedCapital).toBe(600);
    expect(observation.roic).toBeCloseTo((120 * 0.75) / 600, 12);
  });

  it("guards out a reinvestment base at or below 10% of total assets", () => {
    const observation = returnOnInvestedCapital(
      income(2024, { operatingIncome: 120, incomeTaxExpense: 25, pretaxIncome: 100 }),
      sheet(2024, { totalEquity: 100, totalDebt: 0, cashAndEquivalents: 20, totalAssets: 1000 }),
    );

    expect(observation.guard).toBe("reinvestment-base-too-small");
    expect(observation.investedCapital).toBe(80);
    expect(observation.roic).toBeNull();
  });

  it("guards out a negative reinvestment base", () => {
    const observation = returnOnInvestedCapital(
      income(2024, { operatingIncome: 120 }),
      sheet(2024, { totalEquity: 100, totalDebt: 0, cashAndEquivalents: 400, totalAssets: 1000 }),
    );

    expect(observation.guard).toBe("reinvestment-base-too-small");
    expect(observation.roic).toBeNull();
  });

  it("keeps a base just above the guard, and reads missing debt and cash as zero", () => {
    const observation = returnOnInvestedCapital(
      income(2024, { operatingIncome: 100 }),
      sheet(2024, { totalEquity: 150, totalAssets: 1000 }),
    );

    expect(observation.guard).toBeNull();
    expect(observation.investedCapital).toBe(150);
    expect(observation.roic).toBeCloseTo((100 * (1 - DEFAULT_EFFECTIVE_TAX_RATE)) / 150, 12);
  });

  it("reports missing line items separately from the denominator guard", () => {
    expect(returnOnInvestedCapital(income(2024, { operatingIncome: 100 }), sheet(2024)).guard).toBe("insufficient-data");
    expect(returnOnInvestedCapital(income(2024), sheet(2024, { totalEquity: 500 })).guard).toBe("insufficient-data");
    expect(returnOnInvestedCapital(income(2024, { operatingIncome: 100 }), undefined).guard).toBe("insufficient-data");
  });
});

describe("computeGrowthRoicSeries", () => {
  const statements = [
    income(2022, { revenue: 100, operatingIncome: 20 }),
    income(2023, { revenue: 120, operatingIncome: 24 }),
    income(2024, { revenue: 150, operatingIncome: 30 }),
  ];
  const sheets = [
    sheet(2022, { totalEquity: 400, totalDebt: 100, cashAndEquivalents: 50, totalAssets: 800 }),
    sheet(2023, { totalEquity: 420, totalDebt: 100, cashAndEquivalents: 50, totalAssets: 900 }),
    sheet(2024, { totalEquity: 60, totalDebt: 0, cashAndEquivalents: 0, totalAssets: 1000 }),
  ];

  it("computes year-over-year revenue growth oldest-first, with no growth in the first year", () => {
    const series = computeGrowthRoicSeries(statements, sheets);

    expect(series.map((point) => point.fiscalYear)).toEqual([2022, 2023, 2024]);
    expect(series[0].revenueGrowth).toBeNull();
    expect(series[1].revenueGrowth).toBeCloseTo(0.2, 12);
    expect(series[2].revenueGrowth).toBeCloseTo(0.25, 12);
  });

  it("sorts unordered input and leaves ROIC guarded where the reinvestment base is too small", () => {
    const series = computeGrowthRoicSeries([...statements].reverse(), sheets);

    expect(series.map((point) => point.fiscalYear)).toEqual([2022, 2023, 2024]);
    expect(series[1].roic).toBeCloseTo((24 * (1 - DEFAULT_EFFECTIVE_TAX_RATE)) / 470, 12);
    expect(series[2].roic).toBeNull();
    expect(series[2].guard).toBe("reinvestment-base-too-small");
  });

  it("does not compute growth across a gap in fiscal years", () => {
    const series = computeGrowthRoicSeries(
      [income(2020, { revenue: 100 }), income(2024, { revenue: 150 })],
      [],
    );

    expect(series[1].revenueGrowth).toBeNull();
  });
});

describe("scenarioDefaults", () => {
  const statements = [
    income(2021, { revenue: 100, operatingIncome: 10, netIncome: 8, sharesOutstandingDiluted: 100 }),
    income(2022, { revenue: 120, operatingIncome: 18, netIncome: 14, sharesOutstandingDiluted: 100 }),
    income(2023, { revenue: 150, operatingIncome: 30, netIncome: 24, sharesOutstandingDiluted: 100 }),
    income(2024, { revenue: 165, operatingIncome: 33, netIncome: 26, sharesOutstandingDiluted: 100 }),
  ];
  const flows = [
    cash(2021, { freeCashFlow: 8 }),
    cash(2022, { freeCashFlow: 14 }),
    cash(2023, { freeCashFlow: 24 }),
    cash(2024, { freeCashFlow: 26 }),
  ];

  it("reports the median and the full high-low range of the ingested window", () => {
    const defaults = scenarioDefaults(statements, flows);

    // Growth: 20%, 25%, 10% → median 20%, low 10%, high 25%.
    expect(defaults.growth.observations).toBe(3);
    expect(defaults.growth.basis).toBe("history");
    expect(defaults.growth.median).toBeCloseTo(0.2, 12);
    expect(defaults.growth.low).toBeCloseTo(0.1, 12);
    expect(defaults.growth.high).toBeCloseTo(0.25, 12);

    // Margins: 10%, 15%, 20%, 20% → median (15%+20%)/2 = 17.5%.
    expect(defaults.margin.observations).toBe(4);
    expect(defaults.margin.median).toBeCloseTo(0.175, 12);
    expect(defaults.margin.low).toBeCloseTo(0.1, 12);
    expect(defaults.margin.high).toBeCloseTo(0.2, 12);
  });

  it("anchors the exit multiple on today's P/E, clamped into the allowed band", () => {
    // 26 net income on 100 shares = $0.26 EPS; at $4.00 that is a 15.4× multiple.
    const inBand = scenarioDefaults(statements, flows, { sharePrice: 4, sharesOutstanding: 100 });
    expect(inBand.exitPe.suggested).toBe(15.5);
    expect(inBand.exitPe.note).toContain("assumption, not data");

    const rich = scenarioDefaults(statements, flows, { sharePrice: 40, sharesOutstanding: 100 });
    expect(rich.exitPe.suggested).toBe(25);

    const cheap = scenarioDefaults(statements, flows, { sharePrice: 1, sharesOutstanding: 100 });
    expect(cheap.exitPe.suggested).toBe(8);
  });

  it("falls back to the exit-multiple convention when today's P/E cannot be computed", () => {
    const lossMaking = statements.map((statement) => ({ ...statement, netIncome: -10 }));
    const defaults = scenarioDefaults(lossMaking, flows, { sharePrice: 4, sharesOutstanding: 100 });

    expect(defaults.exitPe.suggested).toBe(EXIT_PE_FALLBACK);
    expect(defaults.exitPe.note).toContain("convention");
  });

  it("flags weak cash conversion in the exit-multiple note", () => {
    const weakCash = flows.map((flow) => ({ ...flow, freeCashFlow: (flow.freeCashFlow ?? 0) * 0.5 }));
    const defaults = scenarioDefaults(statements, weakCash, { sharePrice: 4, sharesOutstanding: 100 });

    expect(defaults.exitPe.note).toContain("50%");
  });

  it("labels placeholder bands as conventions when there is no usable history", () => {
    const defaults = scenarioDefaults([], []);

    expect(defaults.growth.basis).toBe("convention");
    expect(defaults.growth.observations).toBe(0);
    expect(defaults.margin.basis).toBe("convention");
    expect(defaults.exitPe.suggested).toBe(EXIT_PE_FALLBACK);
  });
});

describe("dominantDriver", () => {
  it("names growth when its historical range moves the return furthest", () => {
    const result = dominantDriver({
      base: BASE,
      growth: { low: 0, high: 0.5 },
      margin: { low: 0.19, high: 0.21 },
    });

    expect(result.driver).toBe("growth");
    expect(result.spreads.growth!).toBeGreaterThan(result.spreads.margin!);
    expect(result.spreads.growth!).toBeGreaterThan(result.spreads.exitPe!);
  });

  it("names the exit multiple when both historical ranges are tight", () => {
    const result = dominantDriver({
      base: BASE,
      growth: { low: 0.099, high: 0.101 },
      margin: { low: 0.199, high: 0.201 },
    });

    expect(result.driver).toBe("exitPe");
  });

  it("names margin when its range dominates", () => {
    const result = dominantDriver({
      base: BASE,
      growth: { low: 0.099, high: 0.101 },
      margin: { low: 0.05, high: 0.4 },
      exitPeSwing: 0.02,
    });

    expect(result.driver).toBe("margin");
  });

  it("measures each spread against the identical scenario at the range endpoints", () => {
    const result = dominantDriver({
      base: BASE,
      growth: { low: 0, high: 0.2 },
      margin: { low: 0.1, high: 0.3 },
      exitPeSwing: 0.3,
    });

    const expected = Math.abs(
      computeScenario({ ...BASE, growthRate: 0.2 }).annualizedReturn! -
        computeScenario({ ...BASE, growthRate: 0 }).annualizedReturn!,
    );
    expect(result.spreads.growth).toBeCloseTo(expected, 12);
  });

  it("reports no driver when the scenario itself cannot be computed", () => {
    const result = dominantDriver({
      base: { ...BASE, sharePrice: 0 },
      growth: { low: 0, high: 0.2 },
      margin: { low: 0.1, high: 0.3 },
    });

    expect(result.driver).toBeNull();
    expect(result.spreads.growth).toBeNull();
    expect(result.spreads.margin).toBeNull();
    expect(result.spreads.exitPe).toBeNull();
  });
});
