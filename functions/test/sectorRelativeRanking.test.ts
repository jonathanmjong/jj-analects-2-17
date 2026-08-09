import { describe, expect, it } from "vitest";
import type { MetricDefinition, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings, DEFAULT_RANKING_CONFIG, METRIC_CATEGORIES } from "@proverbs/shared";

// Regression coverage: asset/inventory/receivable turnover are explicitly documented (see
// shared/src/metricRationale.ts) as "most meaningful compared within a sector" — a retailer and
// a software company have structurally different "normal" turnover ratios for reasons that have
// nothing to do with which is the better investment. sectorRelative percentile-ranks each
// company against same-sector peers only, instead of the whole universe.
const turnoverLikeMetric: MetricDefinition = {
  key: "turnover_like",
  label: "Turnover-like",
  category: "efficiency",
  direction: "desc",
  unit: "ratio",
  description: "test fixture",
  enabled: true,
  sectorRelative: true,
};

function configFor(metric: MetricDefinition): RankingWeightsConfig {
  return {
    ...DEFAULT_RANKING_CONFIG,
    categoryWeights: Object.fromEntries(
      METRIC_CATEGORIES.map((c) => [c, c === metric.category ? 1 : 0]),
    ) as RankingWeightsConfig["categoryWeights"],
    yearsIncluded: 1,
    winsorizeLowerPct: 0,
    winsorizeUpperPct: 1,
  };
}

function company(ticker: string, sector: string | null, value: number): UniverseCompanyData {
  return { ticker, sector, byYear: [{ turnover_like: value }] };
}

describe("computeCrossSectionalRankings — sectorRelative", () => {
  it("ranks a company against same-sector peers only, not the whole universe", () => {
    // Retail sector: turnover values 8, 6, 4 (high, normal for retail). Software sector: 2, 1
    // (high, normal for software, but would rank dead last universe-wide against retail).
    const universe = [
      company("RETAIL_HIGH", "Consumer Discretionary", 8),
      company("RETAIL_MID", "Consumer Discretionary", 6),
      company("RETAIL_LOW", "Consumer Discretionary", 4),
      company("SOFTWARE_HIGH", "Technology", 2),
      company("SOFTWARE_LOW", "Technology", 1),
    ];
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [turnoverLikeMetric], configFor(turnoverLikeMetric));
    const stats = metricUnitScores.get("turnover_like")!.get(0)!;

    // Within its own sector, SOFTWARE_HIGH (2) should rank #1 of 2 — not dead last universe-wide.
    expect(stats.rankByTicker.get("SOFTWARE_HIGH")).toBe(1);
    expect(stats.rankByTicker.get("SOFTWARE_LOW")).toBe(2);
    expect(stats.peerCountByTicker.get("SOFTWARE_HIGH")).toBe(2);

    // Retail group ranks independently among its own 3 peers.
    expect(stats.rankByTicker.get("RETAIL_HIGH")).toBe(1);
    expect(stats.rankByTicker.get("RETAIL_MID")).toBe(2);
    expect(stats.rankByTicker.get("RETAIL_LOW")).toBe(3);
    expect(stats.peerCountByTicker.get("RETAIL_HIGH")).toBe(3);

    // SOFTWARE_HIGH's sector-relative score (best in its 2-company sector) should beat
    // RETAIL_LOW's (worst in its 3-company sector) even though its raw value (2) is far below
    // RETAIL_LOW's raw value (4) — proof this is genuinely sector-relative, not just relabeled
    // universe-wide ranking.
    expect(stats.scoreByTicker.get("SOFTWARE_HIGH")!).toBeGreaterThan(stats.scoreByTicker.get("RETAIL_LOW")!);
  });

  it("groups companies with no sector on record together, not into any real sector's group", () => {
    const universe = [
      company("REAL_SECTOR_A", "Technology", 10),
      company("NO_SECTOR_A", null, 5),
      company("NO_SECTOR_B", null, 3),
    ];
    const { metricUnitScores } = computeCrossSectionalRankings(universe, [turnoverLikeMetric], configFor(turnoverLikeMetric));
    const stats = metricUnitScores.get("turnover_like")!.get(0)!;

    // REAL_SECTOR_A is alone in its sector (peer group size 1) — too few peers to rank
    // meaningfully, so it's left missing rather than trivially "ranked #1 of 1".
    expect(stats.rankByTicker.has("REAL_SECTOR_A")).toBe(false);

    // The two null-sector companies form their own 2-company group and rank normally.
    expect(stats.rankByTicker.get("NO_SECTOR_A")).toBe(1);
    expect(stats.rankByTicker.get("NO_SECTOR_B")).toBe(2);
  });

  it("leaves non-sectorRelative metrics ranked universe-wide as before (no behavior change)", () => {
    const universeWideMetric: MetricDefinition = { ...turnoverLikeMetric, key: "universe_wide", sectorRelative: undefined };
    const universe = [
      { ticker: "A", sector: "Technology", byYear: [{ universe_wide: 10 }] },
      { ticker: "B", sector: "Consumer Discretionary", byYear: [{ universe_wide: 5 }] },
      { ticker: "C", sector: "Consumer Discretionary", byYear: [{ universe_wide: 1 }] },
    ];
    const { metricUnitScores } = computeCrossSectionalRankings(
      universe,
      [universeWideMetric],
      configFor(universeWideMetric),
    );
    const stats = metricUnitScores.get("universe_wide")!.get(0)!;
    expect(stats.rankByTicker.get("A")).toBe(1);
    expect(stats.rankByTicker.get("B")).toBe(2);
    expect(stats.rankByTicker.get("C")).toBe(3);
    expect(stats.peerCountByTicker.get("A")).toBe(3);
  });
});
