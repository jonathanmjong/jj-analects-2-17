import { describe, expect, it } from "vitest";
import { getMetricRationale, isMetricApplicable, VERDICT_DEFAULT_WEIGHT, defaultMetricWeight } from "@proverbs/shared";
import { grossProfitability } from "../src/metrics/calculators/profitability.js";
import { assetGrowth, netOperatingAssets } from "../src/metrics/calculators/earningsQuality.js";
import { METRIC_DEFINITIONS } from "../src/metrics/definitions.js";
import type { MetricInput, PeriodFinancials } from "../src/metrics/types.js";

/**
 * The three cross-sectional factors added from FEATURE-RESEARCH.md §4's "gaps the panel raised"
 * list: gross profitability (Novy-Marx), asset growth (Cooper/Gulen/Schill) and net operating
 * assets (Hirshleifer et al.). The fourth item on that list — net share issuance — was NOT added:
 * `share_count_change` already computes exactly it (year-over-year change in diluted shares,
 * direction "asc"), and the last test in this file pins that so nobody adds the duplicate later.
 *
 * Two things matter beyond the arithmetic and are asserted here rather than left to review:
 * direction (all three are only worth adding if "more assets" and "more bloat" score WORSE), and
 * null propagation (a missing input must never be read as a zero, and the two year-over-year
 * metrics must refuse to compute against a company with a single year of statements).
 */

const meta = {
  periodKey: "2025-FY",
  periodType: "FY" as const,
  fiscalYear: 2025,
  periodEnd: "2025-12-31",
  filedAt: null,
  sourceProvider: "test",
};

type PeriodOverrides = Partial<PeriodFinancials["income"]> &
  Partial<PeriodFinancials["balance"]> &
  Partial<PeriodFinancials["cashFlow"]>;

function period(overrides: PeriodOverrides = {}): PeriodFinancials {
  return {
    income: {
      ...meta,
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
    },
    balance: {
      ...meta,
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
      ...meta,
      operatingCashFlow: 220,
      capitalExpenditures: -50,
      depreciationAndAmortization: 60,
      freeCashFlow: 170,
      dividendsPaid: -30,
      stockBuybacks: -20,
      stockIssuance: 5,
      netDebtIssuance: null,
      ...overrides,
    },
  };
}

function input(series: PeriodFinancials[]): MetricInput {
  return {
    ticker: "TEST",
    periodKey: series[0].income.periodKey,
    current: series[0],
    series,
    marketCap: 5000,
    enterpriseValue: 5100,
    sharePrice: 50,
    sharesOutstanding: 100,
    momentum: null,
  };
}

function definition(key: string) {
  const found = METRIC_DEFINITIONS.find((m) => m.key === key);
  expect(found, `metric "${key}" is missing from the registry`).toBeDefined();
  return found!;
}

// --------------------------------------------------------------------------------------------
// Gross profitability — gross profit / total assets (Novy-Marx, 2013)
// --------------------------------------------------------------------------------------------

describe("grossProfitability", () => {
  it("computes gross profit over total assets", () => {
    // 400 / 2000 = 0.20
    expect(grossProfitability(input([period()]))).toBeCloseTo(0.2, 10);
  });

  it("is not gross margin — same margin, different asset base gives a different answer", () => {
    // Both have a 40% gross margin; the asset-light one earns that profit on half the assets.
    const assetLight = grossProfitability(input([period({ totalAssets: 1000 })]));
    const assetHeavy = grossProfitability(input([period({ totalAssets: 4000 })]));
    expect(assetLight).toBeCloseTo(0.4, 10);
    expect(assetHeavy).toBeCloseTo(0.1, 10);
  });

  it("keeps a negative gross profit negative rather than dropping it", () => {
    expect(grossProfitability(input([period({ grossProfit: -200 })]))).toBeCloseTo(-0.1, 10);
  });

  it("returns null when gross profit is missing", () => {
    expect(grossProfitability(input([period({ grossProfit: null })]))).toBeNull();
  });

  it("returns null when total assets are missing or zero", () => {
    expect(grossProfitability(input([period({ totalAssets: null })]))).toBeNull();
    expect(grossProfitability(input([period({ totalAssets: 0 })]))).toBeNull();
  });

  it("needs only the current year — a single-year company still gets a value", () => {
    expect(grossProfitability(input([period()]))).not.toBeNull();
  });
});

// --------------------------------------------------------------------------------------------
// Asset growth — YoY change in total assets (Cooper, Gulen & Schill, 2008)
// --------------------------------------------------------------------------------------------

describe("assetGrowth", () => {
  it("computes the year-over-year change in total assets", () => {
    // (2200 - 2000) / 2000 = +0.10
    const series = [period({ totalAssets: 2200 }), period({ totalAssets: 2000 })];
    expect(assetGrowth(input(series))).toBeCloseTo(0.1, 10);
  });

  it("returns a negative value for a shrinking balance sheet", () => {
    // (1600 - 2000) / 2000 = -0.20
    const series = [period({ totalAssets: 1600 }), period({ totalAssets: 2000 })];
    expect(assetGrowth(input(series))).toBeCloseTo(-0.2, 10);
  });

  it("returns null when only one year of history exists", () => {
    expect(assetGrowth(input([period()]))).toBeNull();
  });

  it("returns null when either year's total assets are missing", () => {
    expect(assetGrowth(input([period({ totalAssets: null }), period()]))).toBeNull();
    expect(assetGrowth(input([period(), period({ totalAssets: null })]))).toBeNull();
  });

  it("returns null on a non-positive prior asset base rather than emitting a sign-flipped percentage", () => {
    expect(assetGrowth(input([period(), period({ totalAssets: 0 })]))).toBeNull();
    expect(assetGrowth(input([period(), period({ totalAssets: -100 })]))).toBeNull();
  });

  it("reads the prior year from the series, not from the current period", () => {
    // series[2] is a distractor: only series[1] may be used as the comparison year.
    const series = [period({ totalAssets: 2200 }), period({ totalAssets: 2000 }), period({ totalAssets: 500 })];
    expect(assetGrowth(input(series))).toBeCloseTo(0.1, 10);
  });
});

// --------------------------------------------------------------------------------------------
// Net operating assets — (operating assets - operating liabilities) / lagged total assets
// (Hirshleifer, Hou, Teoh & Zhang, 2004)
// --------------------------------------------------------------------------------------------

describe("netOperatingAssets", () => {
  it("computes (equity + debt - cash) over the PRIOR year's total assets", () => {
    // (1100 + 400 - 300) = 1200 net operating assets, over prior-year assets of 1500 = 0.80
    const series = [period(), period({ totalAssets: 1500 })];
    expect(netOperatingAssets(input(series))).toBeCloseTo(0.8, 10);
  });

  it("uses the lagged denominator, not the current one", () => {
    const lagged = netOperatingAssets(input([period(), period({ totalAssets: 1500 })]));
    const current = netOperatingAssets(input([period(), period({ totalAssets: 2000 })]));
    expect(lagged).toBeCloseTo(0.8, 10);
    expect(current).toBeCloseTo(0.6, 10);
  });

  it("goes negative when cash exceeds the capital funding the operating base", () => {
    // A net-cash business its own liabilities finance: (200 + 0 - 900) / 1500 = -0.4666...
    const series = [period({ totalEquity: 200, totalDebt: 0, cashAndEquivalents: 900 }), period({ totalAssets: 1500 })];
    expect(netOperatingAssets(input(series))).toBeCloseTo(-0.466666666, 8);
  });

  it("returns null when only one year of history exists", () => {
    expect(netOperatingAssets(input([period()]))).toBeNull();
  });

  it("returns null when any single input is missing — never treated as zero", () => {
    const prior = period({ totalAssets: 1500 });
    expect(netOperatingAssets(input([period({ totalEquity: null }), prior]))).toBeNull();
    expect(netOperatingAssets(input([period({ totalDebt: null }), prior]))).toBeNull();
    expect(netOperatingAssets(input([period({ cashAndEquivalents: null }), prior]))).toBeNull();
    expect(netOperatingAssets(input([period(), period({ totalAssets: null })]))).toBeNull();
  });

  it("does not silently substitute zero for a missing cash balance", () => {
    // If missing cash were read as 0 this would be (1100 + 400) / 1500 = 1.0 instead of null.
    const withCash = netOperatingAssets(input([period({ cashAndEquivalents: 0 }), period({ totalAssets: 1500 })]));
    expect(withCash).toBeCloseTo(1, 10);
    expect(netOperatingAssets(input([period({ cashAndEquivalents: null }), period({ totalAssets: 1500 })]))).toBeNull();
  });

  it("returns null on a non-positive lagged asset base", () => {
    expect(netOperatingAssets(input([period(), period({ totalAssets: 0 })]))).toBeNull();
    expect(netOperatingAssets(input([period(), period({ totalAssets: -50 })]))).toBeNull();
  });
});

// --------------------------------------------------------------------------------------------
// Registry configuration: the direction is the whole point of two of these three
// --------------------------------------------------------------------------------------------

describe("factor metrics — registry configuration", () => {
  it("gross profitability is a profitability metric where higher is better", () => {
    const m = definition("gross_profitability");
    expect(m.category).toBe("profitability");
    expect(m.direction).toBe("desc");
    expect(m.enabled).toBe(true);
  });

  it("asset growth and net operating assets are earnings-quality metrics where LOWER is better", () => {
    for (const key of ["asset_growth", "net_operating_assets"]) {
      const m = definition(key);
      expect(m.category, `${key} category`).toBe("earningsQuality");
      expect(m.direction, `${key} direction — the entire point of adding it`).toBe("asc");
      expect(m.enabled).toBe(true);
    }
  });

  it("none of the three is flagged negativeIsBad — negative readings are meaningful, not denominator artifacts", () => {
    // negativeIsBad exists for price/EV/debt ratios over a denominator that can go negative
    // (a P/E of -50 is not cheap). All three of these divide by total assets, which the
    // calculators require to be positive, so a negative value comes from the numerator and
    // carries its literal meaning: shrinking assets, or a business financed by its own
    // operating liabilities. Both are the GOOD end of an "asc" metric.
    for (const key of ["gross_profitability", "asset_growth", "net_operating_assets"]) {
      expect(definition(key).negativeIsBad, `${key} should not be negativeIsBad`).not.toBe(true);
    }
  });

  it("none of the three is flagged sectorRelative (they rank against the whole universe)", () => {
    for (const key of ["gross_profitability", "asset_growth", "net_operating_assets"]) {
      expect(definition(key).sectorRelative, `${key}`).not.toBe(true);
    }
  });

  it("each description states its limitations rather than overclaiming", () => {
    // The panel's binding rule (FEATURE-RESEARCH.md §4): neutral, non-overclaiming language.
    for (const key of ["gross_profitability", "asset_growth", "net_operating_assets"]) {
      const description = definition(key).description;
      expect(description.length).toBeGreaterThan(80);
      expect(description, `${key} must not promise returns`).not.toMatch(/\b(guarantee|will outperform|proven to beat|best)\b/i);
    }
    // The two constructions that are approximations of the published definition must say so.
    expect(definition("net_operating_assets").description).toMatch(/long-term only/i);
    expect(definition("asset_growth").description).toMatch(/prior fiscal year/i);
    expect(definition("net_operating_assets").description).toMatch(/prior fiscal year/i);
  });

  it("every new metric has a real rationale entry, with the verdict that sets its default weight", () => {
    // The registry-wide version of this check lives in metricRegistryValueInvesting.test.ts
    // ("every metric has real value-investing rationale content"); this pins the specific
    // verdicts, since the verdict is what VERDICT_DEFAULT_WEIGHT turns into a weight.
    const expectedVerdict: Record<string, "core" | "supporting"> = {
      gross_profitability: "core",
      asset_growth: "supporting",
      net_operating_assets: "supporting",
    };
    for (const [key, verdict] of Object.entries(expectedVerdict)) {
      const m = definition(key);
      const info = getMetricRationale(key, m.category);
      expect(info.verdict, `${key} verdict`).toBe(verdict);
      expect(info.rationale.length, `${key} rationale`).toBeGreaterThan(80);
      expect(defaultMetricWeight(m), `${key} default weight`).toBe(VERDICT_DEFAULT_WEIGHT[verdict]);
    }
  });
});

// --------------------------------------------------------------------------------------------
// Sector applicability decisions
// --------------------------------------------------------------------------------------------

describe("factor metrics — sector applicability", () => {
  it("suppresses gross profitability and net operating assets for Financials", () => {
    // A bank reports no gross profit, and its assets measure the balance sheet it funds; and
    // the operating/financing split net operating assets depends on doesn't exist when the
    // liabilities are the raw material. Both are meaningless-if-computed, the bar for listing.
    for (const key of ["gross_profitability", "net_operating_assets"]) {
      expect(isMetricApplicable(key, "Financials"), key).toBe(false);
      expect(isMetricApplicable(key, "Financial Services"), `${key} (Yahoo wording)`).toBe(false);
    }
  });

  it("keeps asset growth applicable to Financials", () => {
    // Deliberate asymmetry: a bank's total assets are its loan book, so growth in them is a
    // readable fact about the business — arguable, not meaningless, and the file's stated bar
    // says arguable stays applicable.
    expect(isMetricApplicable("asset_growth", "Financials")).toBe(true);
  });

  it("keeps all three applicable to Real Estate", () => {
    for (const key of ["gross_profitability", "asset_growth", "net_operating_assets"]) {
      expect(isMetricApplicable(key, "Real Estate"), key).toBe(true);
    }
  });

  it("keeps all three applicable to operating-company sectors and to companies with no sector", () => {
    for (const sector of ["Technology", "Industrials", "Healthcare", "Energy", null]) {
      for (const key of ["gross_profitability", "asset_growth", "net_operating_assets"]) {
        expect(isMetricApplicable(key, sector), `${key} / ${sector}`).toBe(true);
      }
    }
  });
});

// --------------------------------------------------------------------------------------------
// The one that was NOT added
// --------------------------------------------------------------------------------------------

describe("net share issuance is already in the registry as share_count_change", () => {
  it("has the exact shape a net-share-issuance factor needs, so no duplicate was added", () => {
    const m = definition("share_count_change");
    expect(m.direction, "net issuance must score lower-is-better").toBe("asc");
    expect(m.description).toMatch(/diluted share count/i);
    // No second metric measuring the same thing under another name.
    const issuanceLike = METRIC_DEFINITIONS.filter((d) => /issuance|dilution/i.test(d.key));
    expect(issuanceLike.map((d) => d.key)).toEqual([]);
  });
});
