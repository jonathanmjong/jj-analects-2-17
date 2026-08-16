import { describe, expect, it } from "vitest";
import { aggregateRankings, computeCrossSectionalRankings, computeUnitScores } from "@proverbs/shared";
import baseline from "./fixtures/rankingBaseline.json" with { type: "json" };
import {
  buildFixtureUniverse,
  digest,
  FIXTURE_CONFIGS,
  FIXTURE_METRICS,
  sampleTickers,
  serializeResults,
  serializeUnitScores,
} from "./fixtures/rankingUniverseFixture.js";

/**
 * Frozen output-equivalence regression for the cross-sectional ranking engine.
 *
 * rankingBaseline.json was captured from the pre-optimization implementation (the object/Map
 * version of computeCrossSectionalRankings) against this exact synthetic universe, and must never
 * be regenerated to make a failing test pass — a diff here means the optimized engine changed a
 * number a user would see, which is the one thing the rewrite was not allowed to do.
 *
 * The universe deliberately contains: 322 companies over 11 sector labels (including the
 * "Financial Services" alias, Real Estate, two single-company sectors and a 2-company null-sector
 * group), 47 metric definitions (one disabled, one all-null, one constant-valued, one 0/1-valued),
 * nulls, zeros, negatives, negativeIsBad metrics, sectorRelative metrics, sector-restricted
 * metrics, companies with 1-5 years of history, and heavy value quantization so ties are common.
 */
const universe = buildFixtureUniverse();
const samples = new Set(sampleTickers(universe));

describe("ranking engine — output equivalence with the pre-optimization implementation", () => {
  it("uses the same fixture shape the baseline was captured against", () => {
    expect(universe.length).toBe(baseline.universeSize);
    expect(FIXTURE_METRICS.length).toBe(baseline.metricCount);
    expect(sampleTickers(universe)).toEqual(baseline.sampleTickers);
  });

  for (const { name, config } of FIXTURE_CONFIGS) {
    const expected = (baseline.byConfig as Record<string, {
      resultsDigest: string;
      unitScoresDigest: string;
      rankedCount: number;
      sampleResults: string[];
    }>)[name];

    describe(name, () => {
      const computation = computeCrossSectionalRankings(universe, FIXTURE_METRICS, config);
      const resultLines = serializeResults(computation.results);

      it("reproduces every result bit-for-bit (rank, score, all categoryScore fields, coverage)", () => {
        expect(digest(resultLines)).toBe(expected.resultsDigest);
      });

      it("reproduces the frozen per-company literals for the sampled tickers", () => {
        expect(resultLines.filter((l) => samples.has(l.slice(0, l.indexOf("|"))))).toEqual(expected.sampleResults);
      });

      it("reproduces metricUnitScores exactly (scores, ranks, peer counts, and which metric-years exist)", () => {
        expect(digest(serializeUnitScores(computation, FIXTURE_METRICS, universe, config.yearsIncluded))).toBe(
          expected.unitScoresDigest,
        );
      });

      it("ranks the same number of companies", () => {
        expect(computation.results.filter((r) => r.overallRank !== null).length).toBe(expected.rankedCount);
      });

      it("produces identical output through the split computeUnitScores + aggregateRankings path", () => {
        const unitScores = computeUnitScores(universe, FIXTURE_METRICS, config);
        const split = aggregateRankings(universe, FIXTURE_METRICS, config, unitScores);
        expect(serializeResults(split.results)).toEqual(resultLines);
        expect(digest(serializeUnitScores(split, FIXTURE_METRICS, universe, config.yearsIncluded))).toBe(
          expected.unitScoresDigest,
        );
      });
    });
  }

  it("reuses one cached UnitScoreIndex across weight-only changes without touching phase 1", () => {
    const config = FIXTURE_CONFIGS[0].config;
    const unitScores = computeUnitScores(universe, FIXTURE_METRICS, config);

    // Anything that only moves category/metric weights must be reproducible from the cached index.
    const reweighted = {
      ...config,
      categoryWeights: { ...config.categoryWeights, momentum: 0.3, valuation: 0.05 },
      metricWeights: { roic: 0, pe_ttm: 4 },
    };
    expect(serializeResults(aggregateRankings(universe, FIXTURE_METRICS, reweighted, unitScores).results)).toEqual(
      serializeResults(computeCrossSectionalRankings(universe, FIXTURE_METRICS, reweighted).results),
    );
  });

  it("returns a structured-cloneable UnitScoreIndex (Web Worker transferable)", () => {
    const unitScores = computeUnitScores(universe, FIXTURE_METRICS, FIXTURE_CONFIGS[0].config);
    const cloned = structuredClone(unitScores);
    expect(cloned.scores).toBeInstanceOf(Float64Array);
    expect(Array.from(cloned.scores.slice(0, 64))).toEqual(Array.from(unitScores.scores.slice(0, 64)));
    expect(cloned.metricKeys).toEqual(unitScores.metricKeys);
    expect(cloned.tickers).toEqual(unitScores.tickers);

    // A clone that lost its identity would silently produce a different ranking, so prove it doesn't.
    expect(serializeResults(aggregateRankings(universe, FIXTURE_METRICS, FIXTURE_CONFIGS[0].config, cloned).results)).toEqual(
      serializeResults(computeCrossSectionalRankings(universe, FIXTURE_METRICS, FIXTURE_CONFIGS[0].config).results),
    );
  });
});
