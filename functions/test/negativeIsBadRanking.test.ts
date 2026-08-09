import { describe, expect, it } from "vitest";
import type { MetricDefinition, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings, DEFAULT_RANKING_CONFIG } from "@proverbs/shared";

// Regression test: a P/E-style ratio (marketCap / earnings) goes negative when the
// denominator (earnings) is negative, not when the company is "cheap." Before this fix, an
// "asc" (lower-is-better) metric sorted purely by raw value, so a company losing money (P/E
// -50) outranked every profitable company — the ranking engine treated "cheapest" as "most
// negative." negativeIsBad forces every positive-value company above every negative-value one.
const peLikeMetric: MetricDefinition = {
  key: "pe_like",
  label: "P/E-like",
  category: "valuation",
  direction: "asc",
  unit: "multiple",
  description: "test fixture",
  enabled: true,
  negativeIsBad: true,
};

function configFor(metrics: MetricDefinition[]): RankingWeightsConfig {
  return {
    ...DEFAULT_RANKING_CONFIG,
    categoryWeights: Object.fromEntries(
      Object.keys(DEFAULT_RANKING_CONFIG.categoryWeights).map((c) => [c, c === "valuation" ? 1 : 0]),
    ) as RankingWeightsConfig["categoryWeights"],
    yearsIncluded: 1,
    winsorizeLowerPct: 0,
    winsorizeUpperPct: 1,
  };
}

function universeOf(values: Record<string, number>): UniverseCompanyData[] {
  return Object.entries(values).map(([ticker, value]) => ({ ticker, sector: null, byYear: [{ pe_like: value }] }));
}

describe("computeCrossSectionalRankings — negativeIsBad", () => {
  it("ranks every positive value above every negative value, regardless of magnitude", () => {
    // CHEAP: lowest positive P/E (best). EXPENSIVE: highest positive P/E (worst of the positives).
    // SMALL_LOSS / BIG_LOSS: negative earnings — should both rank below CHEAP and EXPENSIVE.
    const universe = universeOf({ CHEAP: 5, EXPENSIVE: 50, SMALL_LOSS: -1, BIG_LOSS: -1000 });
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [peLikeMetric], configFor([peLikeMetric]));

    const stats = metricUnitScores.get("pe_like")!.get(0)!;
    const score = (t: string) => stats.scoreByTicker.get(t)!;

    expect(score("CHEAP")).toBeGreaterThan(score("EXPENSIVE"));
    expect(score("EXPENSIVE")).toBeGreaterThan(score("SMALL_LOSS"));
    expect(score("SMALL_LOSS")).toBeGreaterThan(score("BIG_LOSS"));

    expect(stats.rankByTicker.get("CHEAP")).toBe(1);
    expect(stats.rankByTicker.get("EXPENSIVE")).toBe(2);
    expect(stats.rankByTicker.get("SMALL_LOSS")).toBe(3);
    expect(stats.rankByTicker.get("BIG_LOSS")).toBe(4);
  });

  it("within the negative group, a smaller loss (closer to zero) ranks better than a larger one", () => {
    const universe = universeOf({ TINY_LOSS: -0.5, MODERATE_LOSS: -20, HUGE_LOSS: -500 });
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [peLikeMetric], configFor([peLikeMetric]));
    const stats = metricUnitScores.get("pe_like")!.get(0)!;
    const score = (t: string) => stats.scoreByTicker.get(t)!;

    expect(score("TINY_LOSS")).toBeGreaterThan(score("MODERATE_LOSS"));
    expect(score("MODERATE_LOSS")).toBeGreaterThan(score("HUGE_LOSS"));
  });

  it("does not split the group when every value is positive (no behavior change)", () => {
    const universe = universeOf({ A: 5, B: 10, C: 20 });
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [peLikeMetric], configFor([peLikeMetric]));
    const stats = metricUnitScores.get("pe_like")!.get(0)!;
    // Lower is still better (asc): A (lowest) should be rank 1.
    expect(stats.rankByTicker.get("A")).toBe(1);
    expect(stats.rankByTicker.get("C")).toBe(3);
  });

  it("leaves metrics without negativeIsBad using the original ascending-only behavior", () => {
    // e.g. share_count_change: negative is intentionally the GOOD end (buybacks) — must not be
    // pushed below positives.
    const shareCountChange: MetricDefinition = { ...peLikeMetric, key: "share_count_change", negativeIsBad: undefined };
    const universe: UniverseCompanyData[] = [
      { ticker: "BUYBACKS", sector: null, byYear: [{ share_count_change: -0.05 }] },
      { ticker: "DILUTING", sector: null, byYear: [{ share_count_change: 0.1 }] },
    ];
    const { metricUnitScores } = computeCrossSectionalRankings(
      universe,
      [shareCountChange],
      configFor([shareCountChange]),
    );
    const stats = metricUnitScores.get("share_count_change")!.get(0)!;
    // asc direction: the negative (buybacks) value is lower, so it should still win, not be pushed down.
    expect(stats.rankByTicker.get("BUYBACKS")).toBe(1);
    expect(stats.rankByTicker.get("DILUTING")).toBe(2);
  });
});
