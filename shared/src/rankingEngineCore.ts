import type { HeadlineMetrics } from "./company.js";
import type { MetricCategory, MetricDefinition } from "./metrics.js";
import { DEFAULT_YEAR_WEIGHTS, METRIC_CATEGORIES } from "./metrics.js";
import type { CategoryScore, RankingResult, RankingWeightsConfig } from "./ranking.js";
import { percentileRanks, weightedAverage, winsorize, zscoreToUnitScore, zscores } from "./rankingMath.js";

export interface UniverseCompanyData {
  ticker: string;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
}

export interface MetricYearStats {
  /** ticker -> direction-adjusted unit score (0-1, higher always means "better performing"). */
  scoreByTicker: Map<string, number>;
  /** ticker -> rank among peers for this metric+year, 1 = best. */
  rankByTicker: Map<string, number>;
  peerCount: number;
}

export interface RankingComputation {
  results: RankingResult[];
  /** metricKey -> yearIndex -> per-metric-year cross-sectional stats, needed by callers that persist percentiles/ranks. */
  metricUnitScores: Map<string, Map<number, MetricYearStats>>;
}

/** Winsorizes + normalizes one group of same-sign values; 0 = lowest raw value in the group, 1 = highest — not yet direction-adjusted. */
function unitScores(
  entries: Array<{ ticker: string; value: number }>,
  config: RankingWeightsConfig,
): Array<{ ticker: string; unit: number }> {
  const winsorized = winsorize(
    entries.map((e) => e.value),
    config.winsorizeLowerPct,
    config.winsorizeUpperPct,
  );
  const normalized =
    config.normalizationMethod === "percentile" ? percentileRanks(winsorized) : zscores(winsorized).map(zscoreToUnitScore);
  return entries.map((e, idx) => ({ ticker: e.ticker, unit: normalized[idx] }));
}

function extractHeadlineMetrics(mostRecentYear: Record<string, number | null> | undefined): HeadlineMetrics {
  return {
    peTtm: mostRecentYear?.pe_ttm ?? null,
    evEbitda: mostRecentYear?.ev_ebitda ?? null,
    dividendYield: mostRecentYear?.dividend_yield ?? null,
    roic: mostRecentYear?.roic ?? null,
    fcfYield: mostRecentYear?.fcf_yield ?? null,
    revenueGrowth1y: mostRecentYear?.growth_revenue_1y ?? null,
  };
}

/**
 * Cross-sectional ranking engine, pure (no I/O). For each metric x
 * fiscal-year-index, normalizes raw values across every company that has one
 * (winsorize then percentile or z-score), flips direction for "asc" metrics,
 * then combines years using DEFAULT_YEAR_WEIGHTS (35/25/20/10/10),
 * renormalized over whichever years are actually present for that company.
 * Metric scores roll up into category scores (equal-weighted across
 * available metrics), and category scores roll up into the overall score
 * using categoryWeights (renormalized over categories that have data for
 * that company).
 *
 * Lives in shared/ so the exact same implementation runs both server-side
 * (functions/src/ranking/rankingEngine.ts, the nightly job) and client-side
 * (web/src/lib/clientRankingEngine.ts, the Rankings page's instant
 * live-reweighting preview) — they must agree bit-for-bit.
 */
export function computeCrossSectionalRankings(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): RankingComputation {
  const yearsIncluded = config.yearsIncluded;
  const enabledMetrics = metrics.filter((m) => m.enabled);

  const metricUnitScores = new Map<string, Map<number, MetricYearStats>>();

  for (const metric of enabledMetrics) {
    const perYear = new Map<number, MetricYearStats>();
    for (let yearIndex = 0; yearIndex < yearsIncluded; yearIndex++) {
      const entries = universe
        .map((c) => ({ ticker: c.ticker, value: c.byYear[yearIndex]?.[metric.key] ?? null }))
        .filter((e): e is { ticker: string; value: number } => e.value !== null && Number.isFinite(e.value));
      if (entries.length < 2) continue;

      const positives = metric.negativeIsBad ? entries.filter((e) => e.value > 0) : entries;
      const nonPositives = metric.negativeIsBad ? entries.filter((e) => e.value <= 0) : [];

      const scoreByTicker = new Map<string, number>();

      if (nonPositives.length === 0) {
        // No split needed: either negativeIsBad doesn't apply to this metric, or every
        // company happens to have a positive value this year — standard single-group scoring.
        unitScores(positives, config).forEach(({ ticker, unit }) => {
          scoreByTicker.set(ticker, metric.direction === "asc" ? 1 - unit : unit);
        });
      } else if (positives.length === 0) {
        // Every company is negative this year — no positive group to rank above, but "closer
        // to zero is less bad" still applies within the group (a smaller loss should still
        // score better than a larger one), not the metric's normal direction.
        unitScores(entries, config).forEach(({ ticker, unit }) => {
          scoreByTicker.set(ticker, unit);
        });
      } else {
        // Every positive-value company must outrank every negative-value one, regardless of
        // magnitude (a P/E of -50 is a worse company than a P/E of 50, not a "cheaper" one).
        // Positive group keeps the metric's normal direction and lands in (0.5, 1]; negative
        // group is scored by closeness to zero (less loss is still less bad) and lands in
        // [0, 0.5) — the two ranges never overlap.
        unitScores(positives, config).forEach(({ ticker, unit }) => {
          const directional = metric.direction === "asc" ? 1 - unit : unit;
          scoreByTicker.set(ticker, 0.5 + 0.5 * directional);
        });
        const NEG_CEILING = 0.5 - 1e-9;
        unitScores(nonPositives, config).forEach(({ ticker, unit }) => {
          scoreByTicker.set(ticker, unit * NEG_CEILING);
        });
      }

      const rankByTicker = new Map<string, number>();
      [...scoreByTicker.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([ticker], idx) => rankByTicker.set(ticker, idx + 1));

      perYear.set(yearIndex, { scoreByTicker, rankByTicker, peerCount: entries.length });
    }
    metricUnitScores.set(metric.key, perYear);
  }

  const results: RankingResult[] = universe.map(({ ticker, byYear }) => {
    const categoryScores: CategoryScore[] = METRIC_CATEGORIES.map((category: MetricCategory) => {
      const metricsInCategory = enabledMetrics.filter((m) => m.category === category);
      const metricScoresForCompany: Array<{ score: number; weight: number }> = [];
      let missingCount = 0;

      for (const metric of metricsInCategory) {
        const metricWeight = config.metricWeights?.[metric.key] ?? 1;
        if (metricWeight <= 0) {
          missingCount++;
          continue;
        }

        const perYear = metricUnitScores.get(metric.key);
        if (!perYear) {
          missingCount++;
          continue;
        }
        const availableYearScores: Array<{ weight: number; score: number }> = [];
        for (let yearIndex = 0; yearIndex < yearsIncluded; yearIndex++) {
          const score = perYear.get(yearIndex)?.scoreByTicker.get(ticker);
          if (score === undefined) continue;
          availableYearScores.push({ weight: DEFAULT_YEAR_WEIGHTS[yearIndex] ?? 0, score });
        }
        if (availableYearScores.length === 0) {
          missingCount++;
          continue;
        }
        const multiYearScore = weightedAverage(availableYearScores);
        if (multiYearScore === null) {
          missingCount++;
          continue;
        }
        metricScoresForCompany.push({ score: multiYearScore, weight: metricWeight });
      }

      const categoryScore = weightedAverage(metricScoresForCompany);

      return {
        category,
        score: categoryScore,
        weight: config.categoryWeights[category],
        metricsIncluded: metricScoresForCompany.length,
        metricsMissing: missingCount,
      };
    });

    const availableCategories = categoryScores.filter((c) => c.score !== null && c.weight > 0);
    const categoryAverage = weightedAverage(
      availableCategories.map((c) => ({ score: c.score as number, weight: c.weight })),
    );
    const overallScore = categoryAverage !== null ? categoryAverage * 100 : null;

    return {
      ticker,
      computedAt: new Date().toISOString(),
      overallScore,
      overallRank: null,
      peerCount: universe.length,
      categoryScores,
      weightsUsed: config,
      headlineMetrics: extractHeadlineMetrics(byYear[0]),
    };
  });

  const ranked = results
    .filter((r) => r.overallScore !== null)
    .sort((a, b) => (b.overallScore as number) - (a.overallScore as number));
  ranked.forEach((r, idx) => {
    r.overallRank = idx + 1;
  });

  return { results, metricUnitScores };
}
