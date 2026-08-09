import { describe, expect, it } from "vitest";
import type { MetricDefinition, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings, DEFAULT_RANKING_CONFIG, METRIC_CATEGORIES } from "@proverbs/shared";

// Regression coverage: a category's metrics no longer count equally by default — a "core"
// verdict metric (shared/src/metricRationale.ts) outweighs a "supporting" one, so a company
// that's strong specifically on the better-grounded metric should score higher than one that's
// equally strong on the weaker one, even though their raw "extremeness" is symmetric.
// cash_to_market_cap (core) and current_ratio (supporting) are both real financialStrength
// metrics with no negativeIsBad complication, chosen specifically to keep this test's expected
// arithmetic simple: core weight 1.0, supporting weight 0.66 (see VERDICT_DEFAULT_WEIGHT in
// shared/src/rankingEngineCore.ts).
const cashToMarketCap: MetricDefinition = {
  key: "cash_to_market_cap",
  label: "Cash / Market Cap",
  category: "financialStrength",
  direction: "desc",
  unit: "percent",
  description: "test fixture using the real metric key so getMetricRationale finds its real verdict",
  enabled: true,
};
const currentRatio: MetricDefinition = {
  key: "current_ratio",
  label: "Current Ratio",
  category: "financialStrength",
  direction: "desc",
  unit: "ratio",
  description: "test fixture using the real metric key so getMetricRationale finds its real verdict",
  enabled: true,
};

function config(): RankingWeightsConfig {
  return {
    ...DEFAULT_RANKING_CONFIG,
    categoryWeights: Object.fromEntries(
      METRIC_CATEGORIES.map((c) => [c, c === "financialStrength" ? 1 : 0]),
    ) as RankingWeightsConfig["categoryWeights"],
    yearsIncluded: 1,
    winsorizeLowerPct: 0,
    winsorizeUpperPct: 1,
    // No metricWeights override — this is specifically testing the verdict-based default.
  };
}

describe("computeCrossSectionalRankings — verdict-weighted metric defaults", () => {
  it("weights a 'core' metric more heavily than a 'supporting' one by default", () => {
    const universe: UniverseCompanyData[] = [
      // Strong on the core metric, weak on the supporting one.
      { ticker: "STRONG_ON_CORE", sector: null, byYear: [{ cash_to_market_cap: 10, current_ratio: 1 }] },
      // Strong on the supporting metric, weak on the core one — symmetric opposite.
      { ticker: "STRONG_ON_SUPPORTING", sector: null, byYear: [{ cash_to_market_cap: 1, current_ratio: 10 }] },
    ];
    const { results } = computeCrossSectionalRankings(universe, [cashToMarketCap, currentRatio], config());

    const strongOnCore = results.find((r) => r.ticker === "STRONG_ON_CORE")!;
    const strongOnSupporting = results.find((r) => r.ticker === "STRONG_ON_SUPPORTING")!;
    const fsScore = (r: typeof strongOnCore) => r.categoryScores.find((c) => c.category === "financialStrength")!.score!;

    // categoryScores[].score is on a 0-1 scale (only the final overallScore gets *100). If both
    // metrics counted equally, both companies would land at exactly 0.5 (symmetric extremes).
    // Verdict-weighting should pull STRONG_ON_CORE meaningfully above 0.5 and
    // STRONG_ON_SUPPORTING meaningfully below it.
    expect(fsScore(strongOnCore)).toBeGreaterThan(0.55);
    expect(fsScore(strongOnSupporting)).toBeLessThan(0.45);
    expect(fsScore(strongOnCore)).toBeGreaterThan(fsScore(strongOnSupporting));

    // Precise expected value: (1*1.0 + 0*0.66) / (1.0+0.66) = 0.6024
    expect(fsScore(strongOnCore)).toBeCloseTo(1 / 1.66, 3);
  });

  it("an explicit metricWeights override still wins over the verdict-based default", () => {
    const universe: UniverseCompanyData[] = [
      { ticker: "A", sector: null, byYear: [{ cash_to_market_cap: 10, current_ratio: 1 }] },
      { ticker: "B", sector: null, byYear: [{ cash_to_market_cap: 1, current_ratio: 10 }] },
    ];
    // Force equal weighting explicitly, overriding the core-vs-supporting default.
    const overridden: RankingWeightsConfig = { ...config(), metricWeights: { cash_to_market_cap: 1, current_ratio: 1 } };
    const { results } = computeCrossSectionalRankings(universe, [cashToMarketCap, currentRatio], overridden);
    const a = results.find((r) => r.ticker === "A")!.categoryScores.find((c) => c.category === "financialStrength")!.score!;
    const b = results.find((r) => r.ticker === "B")!.categoryScores.find((c) => c.category === "financialStrength")!.score!;
    expect(a).toBeCloseTo(0.5, 5);
    expect(b).toBeCloseTo(0.5, 5);
  });
});
