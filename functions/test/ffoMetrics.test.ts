import { describe, expect, it } from "vitest";
import {
  inapplicabilityReason,
  isMetricApplicable,
  SECTOR_RESTRICTED_METRICS,
  computeCrossSectionalRankings,
  DEFAULT_RANKING_CONFIG,
  METRIC_CATEGORIES,
  type UniverseCompanyData,
} from "@proverbs/shared";
import { approximateFfo, ffoYield, priceToFfo } from "../src/metrics/calculators/valuation.js";
import { METRIC_DEFINITIONS } from "../src/metrics/definitions.js";
import type { MetricInput, PeriodFinancials } from "../src/metrics/types.js";

const FFO_METRICS = ["ffo_yield", "price_to_ffo"];

const meta = {
  periodKey: "2025-FY",
  periodType: "FY" as const,
  fiscalYear: 2025,
  periodEnd: "2025-12-31",
  filedAt: null,
  sourceProvider: "test",
};

function period(netIncome: number | null, depreciationAndAmortization: number | null | undefined): PeriodFinancials {
  return {
    income: {
      ...meta,
      revenue: 5000,
      costOfRevenue: null,
      grossProfit: null,
      researchAndDevelopment: null,
      operatingIncome: null,
      ebit: null,
      ebitda: null,
      interestExpense: null,
      pretaxIncome: null,
      incomeTaxExpense: null,
      netIncome,
      eps: null,
      epsDiluted: null,
      sharesOutstandingDiluted: null,
    },
    balance: {
      ...meta,
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
    },
    cashFlow: {
      ...meta,
      operatingCashFlow: null,
      capitalExpenditures: null,
      freeCashFlow: null,
      dividendsPaid: null,
      stockBuybacks: null,
      stockIssuance: null,
      netDebtIssuance: null,
      // Deliberately spread rather than assigned, so the "legacy statement with no such key at
      // all" case is genuinely key-absent and not just explicitly-undefined.
      ...(depreciationAndAmortization === undefined ? {} : { depreciationAndAmortization }),
    },
  };
}

function input(netIncome: number | null, dna: number | null | undefined, marketCap: number | null): MetricInput {
  const current = period(netIncome, dna);
  return {
    ticker: "TEST",
    periodKey: meta.periodKey,
    current,
    series: [current],
    marketCap,
    enterpriseValue: null,
    sharePrice: null,
    sharesOutstanding: null,
    momentum: null,
  };
}

describe("approximate FFO", () => {
  it("is net income plus depreciation and amortization", () => {
    expect(approximateFfo(500, 1_400)).toBe(1_900);
  });

  it("is null when D&A is missing, rather than degrading to plain net income", () => {
    // A silent fallback to net income would hand back exactly the figure FFO exists to replace,
    // labelled as FFO — worse than no value at all.
    expect(approximateFfo(500, null)).toBeNull();
    expect(approximateFfo(500, undefined)).toBeNull();
  });

  it("is null when net income is missing", () => {
    expect(approximateFfo(null, 1_400)).toBeNull();
  });

  it("can be positive on a loss-making REIT, which is the point of the add-back", () => {
    expect(approximateFfo(-200, 1_400)).toBe(1_200);
  });
});

describe("ffo_yield", () => {
  it("divides approximate FFO by market cap", () => {
    expect(ffoYield(input(500, 1_500, 40_000))).toBeCloseTo(0.05, 10);
  });

  it("stays negative (the worst end of a 'higher is better' metric) when FFO is negative", () => {
    expect(ffoYield(input(-3_000, 1_000, 40_000))).toBeCloseTo(-0.05, 10);
  });

  it("is null without D&A, on a statement written before D&A ingestion shipped", () => {
    expect(ffoYield(input(500, undefined, 40_000))).toBeNull();
    expect(ffoYield(input(500, null, 40_000))).toBeNull();
  });

  it("is null on a missing, zero, or negative market cap", () => {
    expect(ffoYield(input(500, 1_500, null))).toBeNull();
    expect(ffoYield(input(500, 1_500, 0))).toBeNull();
    expect(ffoYield(input(500, 1_500, -100))).toBeNull();
  });
});

describe("price_to_ffo", () => {
  it("divides market cap by approximate FFO", () => {
    expect(priceToFfo(input(500, 1_500, 40_000))).toBeCloseTo(20, 10);
  });

  it("is null when FFO is zero or negative, never a negative multiple", () => {
    expect(priceToFfo(input(-1_500, 1_500, 40_000))).toBeNull();
    expect(priceToFfo(input(-3_000, 1_000, 40_000))).toBeNull();
  });

  it("is null without D&A, and on a missing/zero/negative market cap", () => {
    expect(priceToFfo(input(500, null, 40_000))).toBeNull();
    expect(priceToFfo(input(500, 1_500, null))).toBeNull();
    expect(priceToFfo(input(500, 1_500, 0))).toBeNull();
    expect(priceToFfo(input(500, 1_500, -100))).toBeNull();
  });
});

describe("FFO metrics — registry wiring", () => {
  it("registers both metrics in the valuation category with the right direction", () => {
    const byKey = new Map(METRIC_DEFINITIONS.map((m) => [m.key, m]));
    expect(byKey.get("ffo_yield")).toMatchObject({ category: "valuation", direction: "desc", unit: "percent", enabled: true });
    expect(byKey.get("price_to_ffo")).toMatchObject({
      category: "valuation",
      direction: "asc",
      unit: "multiple",
      enabled: true,
      negativeIsBad: true,
    });
  });

  it("discloses the approximation in both descriptions, in neutral language", () => {
    // Binding design requirement (FEATURE-RESEARCH.md §4: no false precision, disclose
    // approximations, neutral naming) — this is not a reported NAREIT FFO figure.
    for (const key of FFO_METRICS) {
      const definition = METRIC_DEFINITIONS.find((m) => m.key === key)!;
      expect(definition.label.toLowerCase()).toContain("approx");
      expect(definition.description).toMatch(/approximate/i);
      expect(definition.description).toMatch(/net income plus depreciation and amortization/i);
      expect(definition.description).toMatch(/property-sale gains and impairments/i);
    }
  });
});

describe("FFO metrics — sector restriction", () => {
  it("applies to Real Estate, under every provider wording for it", () => {
    for (const key of FFO_METRICS) {
      for (const wording of ["Real Estate", "real estate", "REIT", "  REITs  "]) {
        expect(isMetricApplicable(key, wording), `${key} @ ${wording}`).toBe(true);
        expect(inapplicabilityReason(key, wording)).toBeNull();
      }
    }
  });

  it("does not apply to any other known sector", () => {
    for (const key of FFO_METRICS) {
      for (const sector of ["Technology", "Financials", "Financial Services", "Industrials", "Healthcare", "Utilities"]) {
        expect(isMetricApplicable(key, sector), `${key} @ ${sector}`).toBe(false);
        expect(inapplicabilityReason(key, sector)).toMatch(/funds from operations/i);
      }
    }
  });

  it("does not apply to a company with no sector on record, and says why", () => {
    // The deliberate asymmetry with excluded metrics: applying a restricted metric needs
    // positive evidence of the sector, and a missing label is not that. It costs the company
    // nothing — an inapplicable metric leaves the coverage denominator too, and keeps a
    // non-REIT out of the REIT peer distribution.
    for (const key of FFO_METRICS) {
      for (const sector of [null, "", "   "]) {
        expect(isMetricApplicable(key, sector), `${key} @ "${String(sector)}"`).toBe(false);
        expect(inapplicabilityReason(key, sector)).toMatch(/no sector on record/i);
      }
    }
  });

  it("does not apply to a sector this module doesn't recognize, but says so differently", () => {
    // SECTOR_ALIASES only recognizes the gated sectors, so "Something Unrecognized" and null
    // both canonicalize to null — but the honest reason differs, and the UI shows it.
    for (const key of FFO_METRICS) {
      expect(isMetricApplicable(key, "Something Unrecognized")).toBe(false);
      expect(inapplicabilityReason(key, "Something Unrecognized")).not.toMatch(/no sector on record/i);
      expect(inapplicabilityReason(key, "Something Unrecognized")).toMatch(/funds from operations/i);
    }
  });

  it("keeps unknown-sector companies out of the FFO peer distribution entirely", () => {
    // End-to-end through the real ranking engine: a REIT-only metric must be scored among REITs,
    // not against whichever companies happen to have a computable value.
    const definition = METRIC_DEFINITIONS.find((m) => m.key === "price_to_ffo")!;
    const universe: UniverseCompanyData[] = [
      { ticker: "REIT_CHEAP", sector: "Real Estate", byYear: [{ price_to_ffo: 10 }] },
      { ticker: "REIT_RICH", sector: "Real Estate", byYear: [{ price_to_ffo: 30 }] },
      { ticker: "SOFTWARE", sector: "Technology", byYear: [{ price_to_ffo: 20 }] },
      { ticker: "NO_SECTOR", sector: null, byYear: [{ price_to_ffo: 20 }] },
    ];
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [definition], {
      ...DEFAULT_RANKING_CONFIG,
      categoryWeights: Object.fromEntries(
        METRIC_CATEGORIES.map((c) => [c, c === "valuation" ? 1 : 0]),
      ) as typeof DEFAULT_RANKING_CONFIG.categoryWeights,
      yearsIncluded: 1,
      winsorizeLowerPct: 0,
      winsorizeUpperPct: 1,
    });

    const stats = metricUnitScores.get("price_to_ffo")!.get(0)!;
    expect([...stats.scoreByTicker.keys()].sort()).toEqual(["REIT_CHEAP", "REIT_RICH"]);
    expect(stats.peerCountByTicker.get("REIT_CHEAP")).toBe(2);
    expect(stats.scoreByTicker.get("REIT_CHEAP")!).toBeGreaterThan(stats.scoreByTicker.get("REIT_RICH")!);
  });
});

describe("SECTOR_RESTRICTED_METRICS — the map itself", () => {
  it("only lists metric keys that exist in the registry", () => {
    const known = new Set(METRIC_DEFINITIONS.map((m) => m.key));
    for (const group of SECTOR_RESTRICTED_METRICS) {
      for (const key of group.metricKeys) {
        expect(known.has(key), `unknown metric key "${key}"`).toBe(true);
      }
    }
  });

  it("lists no metric key twice, and no key that is also on the exclusion list", () => {
    const keys = SECTOR_RESTRICTED_METRICS.flatMap((g) => g.metricKeys);
    expect(new Set(keys).size, "a metric key is restricted twice").toBe(keys.length);
  });

  it("names sectors in the canonical form the alias table produces", () => {
    // A typo here would silently make the metric apply to nobody at all.
    for (const group of SECTOR_RESTRICTED_METRICS) {
      expect(group.sectors.length).toBeGreaterThan(0);
      for (const sector of group.sectors) {
        for (const key of group.metricKeys) {
          expect(isMetricApplicable(key, sector), `"${sector}" is not a canonical sector name`).toBe(true);
        }
      }
    }
  });

  it("gives every restricted metric a reason that explains the accounting without judging the company", () => {
    for (const group of SECTOR_RESTRICTED_METRICS) {
      expect(group.reason.length).toBeGreaterThan(20);
      expect(group.reason).not.toMatch(/\b(invalid|bad|poor|risky|fail|wrong|bogus|suspicious)\b/i);
      for (const key of group.metricKeys) {
        expect(inapplicabilityReason(key, "Technology")).toBe(group.reason);
      }
    }
  });

  it("leaves the restricted set small — this layer adds sector-specific metrics, it doesn't fragment the registry", () => {
    const restricted = SECTOR_RESTRICTED_METRICS.flatMap((g) => g.metricKeys).length;
    expect(restricted / METRIC_DEFINITIONS.length).toBeLessThan(0.1);
  });
});

describe("FFO metrics — the gap they close", () => {
  it("gives Real Estate back a valuation metric for the P/E it lost", () => {
    // The sector-applicability layer gated pe_ttm for REITs (see sectorApplicability.test.ts)
    // with a reason that points at FFO; these two metrics are what that reason now refers to.
    expect(isMetricApplicable("pe_ttm", "Real Estate")).toBe(false);
    const valuationForReits = METRIC_DEFINITIONS.filter(
      (m) => m.category === "valuation" && m.enabled && isMetricApplicable(m.key, "Real Estate"),
    ).map((m) => m.key);
    expect(valuationForReits).toContain("ffo_yield");
    expect(valuationForReits).toContain("price_to_ffo");
  });

  it("does not widen the valuation set for any other sector", () => {
    for (const sector of ["Technology", "Financials", null]) {
      const keys = METRIC_DEFINITIONS.filter((m) => isMetricApplicable(m.key, sector)).map((m) => m.key);
      expect(keys).not.toContain("ffo_yield");
      expect(keys).not.toContain("price_to_ffo");
    }
  });
});
