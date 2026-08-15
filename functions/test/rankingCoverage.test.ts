import { describe, expect, it } from "vitest";
import type { MetricCategory, MetricDefinition, RankingResult, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings, DEFAULT_RANKING_CONFIG, METRIC_CATEGORIES } from "@proverbs/shared";

function weightOnly(...categories: MetricCategory[]): RankingWeightsConfig["categoryWeights"] {
  return Object.fromEntries(
    METRIC_CATEGORIES.map((c) => [c, categories.includes(c) ? 1 : 0]),
  ) as RankingWeightsConfig["categoryWeights"];
}

function metric(key: string, category: MetricCategory, extra: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    key,
    label: key,
    category,
    direction: "desc",
    unit: "ratio",
    description: "test fixture",
    enabled: true,
    ...extra,
  };
}

function categoryOf(result: RankingResult, category: MetricCategory) {
  return result.categoryScores.find((c) => c.category === category)!;
}

// --------------------------------------------------------------------------------------------
// A bank scored the way a bank can actually be scored.
// --------------------------------------------------------------------------------------------

const BANK_METRICS: MetricDefinition[] = [
  metric("pe_ttm", "valuation", { direction: "asc", negativeIsBad: true }),
  metric("pb", "valuation", { direction: "asc", negativeIsBad: true }),
  metric("ev_ebit", "valuation", { direction: "asc", negativeIsBad: true }),
  metric("roic", "profitability"),
  metric("net_margin", "profitability"),
  metric("current_ratio", "financialStrength"),
];

const BANK_CONFIG: RankingWeightsConfig = {
  ...DEFAULT_RANKING_CONFIG,
  categoryWeights: weightOnly("valuation", "profitability", "financialStrength"),
  yearsIncluded: 1,
};

/**
 * Banks here are given non-null values for every metric, including the inapplicable ones. That's
 * the case worth testing: the bug isn't only that banks come out with fewer metrics, it's that
 * whichever inapplicable metrics *do* happen to compute quietly become part of the score and part
 * of everyone else's peer distribution.
 */
const BANK_UNIVERSE: UniverseCompanyData[] = [
  { ticker: "BANKA", sector: "Financials", byYear: [{ pe_ttm: 13.9, pb: 2.2, ev_ebit: 40, roic: 0.9, net_margin: 0.3, current_ratio: 0.1 }] },
  { ticker: "BANKB", sector: "Financial Services", byYear: [{ pe_ttm: 11, pb: 1.4, ev_ebit: 55, roic: 1.4, net_margin: 0.28, current_ratio: 0.08 }] },
  { ticker: "OPA", sector: "Technology", byYear: [{ pe_ttm: 28, pb: 6, ev_ebit: 22, roic: 0.24, net_margin: 0.21, current_ratio: 2.4 }] },
  { ticker: "OPB", sector: "Industrials", byYear: [{ pe_ttm: 16, pb: 2.5, ev_ebit: 12, roic: 0.15, net_margin: 0.09, current_ratio: 1.9 }] },
  { ticker: "OPC", sector: "Healthcare", byYear: [{ pe_ttm: 19, pb: 3.1, ev_ebit: 15, roic: 0.19, net_margin: 0.17, current_ratio: 2.1 }] },
];

describe("computeCrossSectionalRankings — sector applicability", () => {
  const { results, metricUnitScores } = computeCrossSectionalRankings(BANK_UNIVERSE, BANK_METRICS, BANK_CONFIG);
  const byTicker = new Map(results.map((r) => [r.ticker, r]));

  it("counts inapplicable metrics separately instead of calling them missing", () => {
    const bank = byTicker.get("BANKA")!;

    const valuation = categoryOf(bank, "valuation");
    expect(valuation.metricsIncluded).toBe(2); // pe_ttm, pb
    expect(valuation.metricsMissing).toBe(0); // ev_ebit is not "missing" — it doesn't apply
    expect(valuation.metricsNotApplicable).toBe(1);

    const profitability = categoryOf(bank, "profitability");
    expect(profitability.metricsIncluded).toBe(1); // net_margin
    expect(profitability.metricsMissing).toBe(0);
    expect(profitability.metricsNotApplicable).toBe(1); // roic

    // Every metric in the category is inapplicable, so the category scores null off an empty
    // basis rather than off "everything is missing".
    const strength = categoryOf(bank, "financialStrength");
    expect(strength.score).toBeNull();
    expect(strength.metricsIncluded).toBe(0);
    expect(strength.metricsMissing).toBe(0);
    expect(strength.metricsNotApplicable).toBe(1);
  });

  it("still separates genuinely missing data from inapplicable data", () => {
    const withHole = [...BANK_UNIVERSE, { ticker: "OPD", sector: "Technology", byYear: [{ pe_ttm: 21, pb: null, ev_ebit: 18, roic: 0.2, net_margin: 0.1, current_ratio: 1.5 }] }];
    const { results: r2 } = computeCrossSectionalRankings(withHole, BANK_METRICS, BANK_CONFIG);
    const valuation = categoryOf(r2.find((r) => r.ticker === "OPD")!, "valuation");
    expect(valuation.metricsIncluded).toBe(2);
    expect(valuation.metricsMissing).toBe(1);
    expect(valuation.metricsNotApplicable).toBe(0);
  });

  it("drops inapplicable companies out of that metric's peer group entirely", () => {
    const roic = metricUnitScores.get("roic")!.get(0)!;
    expect([...roic.scoreByTicker.keys()].sort()).toEqual(["OPA", "OPB", "OPC"]);
    expect(roic.peerCountByTicker.get("OPA")).toBe(3);

    // The banks' ROIC values (0.9, 1.4) are the two highest in the fixture. If they were still in
    // the peer group, OPA (0.24) could not be the top-ranked name.
    expect(roic.rankByTicker.get("OPA")).toBe(1);
    expect(roic.rankByTicker.has("BANKA")).toBe(false);

    const currentRatio = metricUnitScores.get("current_ratio")!.get(0)!;
    expect([...currentRatio.scoreByTicker.keys()].sort()).toEqual(["OPA", "OPB", "OPC"]);
  });

  it("keeps applicable metrics ranked across the whole universe, banks included", () => {
    const pe = metricUnitScores.get("pe_ttm")!.get(0)!;
    expect(pe.peerCountByTicker.get("BANKA")).toBe(5);
    expect(pe.rankByTicker.get("BANKB")).toBe(1); // cheapest P/E in the fixture
  });

  it("matches provider sector wordings, so the same bank is gated either way", () => {
    const a = categoryOf(byTicker.get("BANKA")!, "financialStrength");
    const b = categoryOf(byTicker.get("BANKB")!, "financialStrength");
    expect(b.metricsNotApplicable).toBe(a.metricsNotApplicable);
  });

  it("reports coverage that reflects the applicable basis, not the whole registry", () => {
    // 3 of 6 metrics apply to a bank here, and all 3 computed.
    const bank = byTicker.get("BANKA")!;
    expect(bank.coverage).toEqual({ metricsIncluded: 3, metricsApplicable: 3, ratio: 1, tier: "full" });

    const operating = byTicker.get("OPA")!;
    expect(operating.coverage).toEqual({ metricsIncluded: 6, metricsApplicable: 6, ratio: 1, tier: "full" });
  });
});

// --------------------------------------------------------------------------------------------
// Coverage arithmetic
// --------------------------------------------------------------------------------------------

const GENERIC_METRICS: MetricDefinition[] = Array.from({ length: 10 }, (_, i) => metric(`gen_${i}`, "profitability"));

const GENERIC_CONFIG: RankingWeightsConfig = {
  ...DEFAULT_RANKING_CONFIG,
  categoryWeights: weightOnly("profitability"),
  yearsIncluded: 1,
};

function withFirstNMetrics(ticker: string, n: number): UniverseCompanyData {
  const year: Record<string, number | null> = {};
  GENERIC_METRICS.forEach((m, i) => {
    year[m.key] = i < n ? 1 + i : null;
  });
  return { ticker, sector: "Technology", byYear: [year] };
}

describe("computeCrossSectionalRankings — coverage arithmetic", () => {
  const universe = [
    withFirstNMetrics("CONTROL", 10), // present for every metric, so each metric has >= 2 values
    withFirstNMetrics("ALL", 10),
    withFirstNMetrics("SEVEN", 7),
    withFirstNMetrics("FOUR", 4),
    withFirstNMetrics("THREE", 3),
  ];
  const byTicker = new Map(computeCrossSectionalRankings(universe, GENERIC_METRICS, GENERIC_CONFIG).results.map((r) => [r.ticker, r]));

  it("reports ratio 1 and tier full when everything applicable computed", () => {
    expect(byTicker.get("ALL")!.coverage).toEqual({ metricsIncluded: 10, metricsApplicable: 10, ratio: 1, tier: "full" });
  });

  it("treats the tier cut points as inclusive lower bounds", () => {
    expect(byTicker.get("SEVEN")!.coverage).toEqual({ metricsIncluded: 7, metricsApplicable: 10, ratio: 0.7, tier: "full" });
    expect(byTicker.get("FOUR")!.coverage).toEqual({ metricsIncluded: 4, metricsApplicable: 10, ratio: 0.4, tier: "partial" });
    expect(byTicker.get("THREE")!.coverage).toEqual({ metricsIncluded: 3, metricsApplicable: 10, ratio: 0.3, tier: "thin" });
  });

  it("still scores a thin-coverage company — thin describes the evidence, not the company", () => {
    const thin = byTicker.get("THREE")!;
    expect(thin.coverage!.tier).toBe("thin");
    expect(thin.overallScore).not.toBeNull();
  });

  it("handles the zero-applicable edge without dividing by zero", () => {
    // Every weighted metric is inapplicable to a bank, so there is no applicable basis at all.
    const financialsOnly = [
      metric("roic", "profitability"),
      metric("current_ratio", "financialStrength"),
    ];
    const universeWithBanks: UniverseCompanyData[] = [
      { ticker: "BANKA", sector: "Financials", byYear: [{ roic: 0.9, current_ratio: 0.1 }] },
      { ticker: "BANKB", sector: "Financials", byYear: [{ roic: 1.1, current_ratio: 0.2 }] },
      { ticker: "OPA", sector: "Technology", byYear: [{ roic: 0.24, current_ratio: 2.4 }] },
      { ticker: "OPB", sector: "Industrials", byYear: [{ roic: 0.15, current_ratio: 1.9 }] },
    ];
    const config: RankingWeightsConfig = {
      ...DEFAULT_RANKING_CONFIG,
      categoryWeights: weightOnly("profitability", "financialStrength"),
      yearsIncluded: 1,
    };
    const { results } = computeCrossSectionalRankings(universeWithBanks, financialsOnly, config);
    const bank = results.find((r) => r.ticker === "BANKA")!;

    expect(bank.coverage).toEqual({ metricsIncluded: 0, metricsApplicable: 0, ratio: 0, tier: "thin" });
    expect(bank.overallScore).toBeNull();
    expect(bank.overallRank).toBeNull();
  });

  it("ignores categories the caller weights at zero, which contribute nothing to the score", () => {
    const mixed: MetricDefinition[] = [metric("kept", "profitability"), metric("unweighted", "momentum")];
    const universeMixed: UniverseCompanyData[] = [
      { ticker: "A", sector: "Technology", byYear: [{ kept: 1, unweighted: 1 }] },
      { ticker: "B", sector: "Technology", byYear: [{ kept: 2, unweighted: 2 }] },
    ];
    const config: RankingWeightsConfig = { ...DEFAULT_RANKING_CONFIG, categoryWeights: weightOnly("profitability"), yearsIncluded: 1 };
    const { results } = computeCrossSectionalRankings(universeMixed, mixed, config);
    expect(results[0].coverage).toEqual({ metricsIncluded: 1, metricsApplicable: 1, ratio: 1, tier: "full" });
  });
});

// --------------------------------------------------------------------------------------------
// Regression: the applicability layer must be a no-op for ordinary operating companies.
// --------------------------------------------------------------------------------------------

const REGRESSION_METRICS: MetricDefinition[] = [
  metric("pe_ttm", "valuation", { direction: "asc", unit: "multiple", negativeIsBad: true }),
  metric("ev_ebit", "valuation", { direction: "asc", unit: "multiple", negativeIsBad: true }),
  metric("roic", "profitability", { unit: "percent" }),
  metric("net_margin", "profitability", { unit: "percent" }),
  metric("current_ratio", "financialStrength"),
  metric("debt_to_equity", "financialStrength", { direction: "asc", negativeIsBad: true }),
  metric("asset_turnover", "efficiency", { sectorRelative: true }),
  metric("growth_revenue_1y", "growth", { unit: "percent" }),
];

const OPERATING_UNIVERSE: UniverseCompanyData[] = [
  { ticker: "TECHA", sector: "Technology", byYear: [
    { pe_ttm: 28, ev_ebit: 22, roic: 0.24, net_margin: 0.21, current_ratio: 2.4, debt_to_equity: 0.3, asset_turnover: 0.7, growth_revenue_1y: 0.14 },
    { pe_ttm: 31, ev_ebit: 25, roic: 0.22, net_margin: 0.19, current_ratio: 2.2, debt_to_equity: 0.35, asset_turnover: 0.68, growth_revenue_1y: 0.11 },
  ] },
  { ticker: "TECHB", sector: "Technology", byYear: [
    { pe_ttm: 45, ev_ebit: 38, roic: 0.11, net_margin: 0.08, current_ratio: 1.6, debt_to_equity: 0.9, asset_turnover: 0.55, growth_revenue_1y: 0.26 },
    { pe_ttm: -12, ev_ebit: 41, roic: 0.09, net_margin: -0.03, current_ratio: 1.4, debt_to_equity: 1.1, asset_turnover: 0.52, growth_revenue_1y: 0.31 },
  ] },
  { ticker: "INDA", sector: "Industrials", byYear: [
    { pe_ttm: 16, ev_ebit: 12, roic: 0.15, net_margin: 0.09, current_ratio: 1.9, debt_to_equity: 0.7, asset_turnover: 1.3, growth_revenue_1y: 0.05 },
    { pe_ttm: 18, ev_ebit: 13.5, roic: 0.14, net_margin: 0.085, current_ratio: 1.8, debt_to_equity: 0.75, asset_turnover: 1.25, growth_revenue_1y: 0.04 },
  ] },
  { ticker: "INDB", sector: "Industrials", byYear: [
    { pe_ttm: 22, ev_ebit: 17, roic: 0.08, net_margin: 0.04, current_ratio: 1.2, debt_to_equity: 1.8, asset_turnover: 0.95, growth_revenue_1y: -0.02 },
    { pe_ttm: 24, ev_ebit: 19, roic: 0.07, net_margin: 0.035, current_ratio: 1.15, debt_to_equity: 2.1, asset_turnover: 0.9, growth_revenue_1y: 0.01 },
  ] },
  { ticker: "HLTHA", sector: "Healthcare", byYear: [
    { pe_ttm: 19, ev_ebit: 15, roic: 0.19, net_margin: 0.17, current_ratio: 2.1, debt_to_equity: 0.45, asset_turnover: 0.8, growth_revenue_1y: 0.09 },
    { pe_ttm: 20, ev_ebit: 16, roic: 0.18, net_margin: 0.16, current_ratio: 2.0, debt_to_equity: 0.5, asset_turnover: 0.78, growth_revenue_1y: 0.08 },
  ] },
  { ticker: "HLTHB", sector: "Healthcare", byYear: [
    { pe_ttm: 34, ev_ebit: null, roic: null, net_margin: 0.02, current_ratio: 3.1, debt_to_equity: 0.15, asset_turnover: 0.4, growth_revenue_1y: 0.42 },
    { pe_ttm: 38, ev_ebit: null, roic: null, net_margin: 0.01, current_ratio: 3.4, debt_to_equity: 0.12, asset_turnover: 0.38, growth_revenue_1y: 0.55 },
  ] },
];

const REGRESSION_CONFIG: RankingWeightsConfig = { ...DEFAULT_RANKING_CONFIG, yearsIncluded: 2 };

/**
 * Captured from the engine as it ran *before* the sector-applicability layer existed, over the
 * fixture above. Every metric here is one the layer gates for some sector, but none of these
 * companies is in a gated sector, so the layer must not move a single digit. Frozen as literals
 * on purpose: a snapshot regenerated from the current code would happily bless a regression.
 */
const PRE_APPLICABILITY_BASELINE = JSON.parse(`[
  {"ticker":"TECHA","overallScore":70.62500000000001,"overallRank":1,"categoryScores":[{"category":"valuation","score":0.371875,"metricsIncluded":2,"metricsMissing":0},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":1,"metricsIncluded":2,"metricsMissing":0},{"category":"growth","score":0.6000000000000001,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":0.8000000000000002,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":1,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]},
  {"ticker":"TECHB","overallScore":28.191336769721747,"overallRank":5,"categoryScores":[{"category":"valuation","score":0.10416666645833333,"metricsIncluded":2,"metricsMissing":0},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":0.24337349397590363,"metricsIncluded":2,"metricsMissing":0},{"category":"growth","score":0.8,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":0.2,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":0,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]},
  {"ticker":"INDA","overallScore":64.42340791738384,"overallRank":3,"categoryScores":[{"category":"valuation","score":1,"metricsIncluded":2,"metricsMissing":0},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":0.5397590361445783,"metricsIncluded":2,"metricsMissing":0},{"category":"growth","score":0.2,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":0.4000000000000001,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":1,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]},
  {"ticker":"INDB","overallScore":19.021084337349404,"overallRank":6,"categoryScores":[{"category":"valuation","score":0.58125,"metricsIncluded":2,"metricsMissing":0},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":0.11265060240963858,"metricsIncluded":2,"metricsMissing":0},{"category":"growth","score":0,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":0,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":0,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]},
  {"ticker":"HLTHA","overallScore":70.51527538726336,"overallRank":2,"categoryScores":[{"category":"valuation","score":0.790625,"metricsIncluded":2,"metricsMissing":0},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":0.7698795180722892,"metricsIncluded":2,"metricsMissing":0},{"category":"growth","score":0.4,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":0.6000000000000001,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":1,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]},
  {"ticker":"HLTHB","overallScore":46.7857142857143,"overallRank":4,"categoryScores":[{"category":"valuation","score":0.325,"metricsIncluded":1,"metricsMissing":1},{"category":"momentum","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"profitability","score":0.08333333333333334,"metricsIncluded":1,"metricsMissing":1},{"category":"growth","score":1,"metricsIncluded":1,"metricsMissing":0},{"category":"cashGeneration","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"financialStrength","score":1,"metricsIncluded":2,"metricsMissing":0},{"category":"capitalAllocation","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"efficiency","score":0,"metricsIncluded":1,"metricsMissing":0},{"category":"earningsQuality","score":null,"metricsIncluded":0,"metricsMissing":0},{"category":"moat","score":null,"metricsIncluded":0,"metricsMissing":0}]}
]`);

function project(results: RankingResult[]) {
  return results.map((r) => ({
    ticker: r.ticker,
    overallScore: r.overallScore,
    overallRank: r.overallRank,
    categoryScores: r.categoryScores.map((c) => ({
      category: c.category,
      score: c.score,
      metricsIncluded: c.metricsIncluded,
      metricsMissing: c.metricsMissing,
    })),
  }));
}

describe("computeCrossSectionalRankings — operating-company regression", () => {
  const { results } = computeCrossSectionalRankings(OPERATING_UNIVERSE, REGRESSION_METRICS, REGRESSION_CONFIG);

  it("produces scores and ranks identical to the pre-applicability engine", () => {
    expect(project(results)).toEqual(PRE_APPLICABILITY_BASELINE);
  });

  it("marks nothing inapplicable for an operating company", () => {
    for (const result of results) {
      for (const category of result.categoryScores) {
        expect(category.metricsNotApplicable).toBe(0);
      }
    }
  });

  it("leaves every company in every metric's peer group", () => {
    const { metricUnitScores } = computeCrossSectionalRankings(OPERATING_UNIVERSE, REGRESSION_METRICS, REGRESSION_CONFIG);
    const universeWide = metricUnitScores.get("pe_ttm")!.get(0)!;
    expect(universeWide.scoreByTicker.size).toBe(OPERATING_UNIVERSE.length);
  });
});
