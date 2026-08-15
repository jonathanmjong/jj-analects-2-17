import type { HeadlineMetrics } from "./company.js";
import type { MetricCategory, MetricDefinition } from "./metrics.js";
import { DEFAULT_YEAR_WEIGHTS, METRIC_CATEGORIES } from "./metrics.js";
import { getMetricRationale, type MetricVerdict } from "./metricRationale.js";
import type { CategoryScore, CoverageTier, RankingResult, RankingWeightsConfig, ScoreCoverage } from "./ranking.js";
import { percentileRanks, weightedAverage, winsorize, zscoreToUnitScore, zscores } from "./rankingMath.js";
import { isMetricApplicable } from "./sectorApplicability.js";

export interface UniverseCompanyData {
  ticker: string;
  /** Used by sectorRelative metrics to group same-sector peers; companies with no sector on record are grouped together. */
  sector: string | null;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
}

export interface MetricYearStats {
  /** ticker -> direction-adjusted unit score (0-1, higher always means "better performing"). */
  scoreByTicker: Map<string, number>;
  /** ticker -> rank among peers for this metric+year, 1 = best. For a sectorRelative metric, "peers" means same-sector peers. */
  rankByTicker: Map<string, number>;
  /** ticker -> size of the peer group its rank/score were computed against (the whole universe with data, or its sector group for a sectorRelative metric). */
  peerCountByTicker: Map<string, number>;
}

export interface RankingComputation {
  results: RankingResult[];
  /** metricKey -> yearIndex -> per-metric-year cross-sectional stats, needed by callers that persist percentiles/ranks. */
  metricUnitScores: Map<string, Map<number, MetricYearStats>>;
}

/**
 * A metric's default per-metric weight within its category, used only when the caller's config
 * doesn't specify an explicit metricWeights override. Reuses the same verdict taxonomy admins
 * and users see in the Value Metrics panel / hover tooltips (shared/src/metricRationale.ts) so a
 * "use with caution" metric contributes less to the score by default than a "core" one, instead
 * of every metric in a category counting equally regardless of how well-grounded it is.
 * "not-value-investing" (currently only the 3 momentum metrics) stays at full weight here — the
 * primary exclusion mechanism for that is the momentum category's 0% default weight, not a
 * further per-metric penalty, so a user who deliberately turns momentum weighting on isn't also
 * fighting an extra hidden discount.
 */
export const VERDICT_DEFAULT_WEIGHT: Record<MetricVerdict, number> = {
  core: 1,
  supporting: 0.66,
  caveat: 0.33,
  "not-value-investing": 1,
};

/** The weight a metric gets when a caller's config doesn't specify an explicit override — exported so UI weight sliders can display a default that matches what the engine actually applies, instead of assuming a flat 100%. */
export function defaultMetricWeight(metric: MetricDefinition): number {
  return VERDICT_DEFAULT_WEIGHT[getMetricRationale(metric.key, metric.category).verdict];
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

interface GroupResult {
  scoreByTicker: Map<string, number>;
  rankByTicker: Map<string, number>;
  peerCount: number;
}

/**
 * Scores + ranks one peer group (the whole universe with data for a normal metric, or one
 * sector's companies for a sectorRelative metric) for a single metric+year. Handles the
 * negativeIsBad split (see MetricDefinition) within the group.
 */
function computeGroupResult(
  entries: Array<{ ticker: string; value: number }>,
  metric: MetricDefinition,
  config: RankingWeightsConfig,
): GroupResult {
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

  return { scoreByTicker, rankByTicker, peerCount: entries.length };
}

/**
 * Minimum included/applicable ratio for each coverage tier. The cut points are judgement calls,
 * not derived: 0.7 is "most of what could be measured was measured", 0.4 is "enough to compare
 * but read the category breakdown". "thin" says the score rests on a small base — it is a
 * statement about the evidence, never about the company. A thin-coverage business can be an
 * excellent one; the score just isn't standing on much.
 */
export const COVERAGE_TIER_MIN_RATIO: Record<Exclude<CoverageTier, "thin">, number> = {
  full: 0.7,
  partial: 0.4,
};

function coverageTierFor(ratio: number): CoverageTier {
  if (ratio >= COVERAGE_TIER_MIN_RATIO.full) return "full";
  if (ratio >= COVERAGE_TIER_MIN_RATIO.partial) return "partial";
  return "thin";
}

/**
 * Counts only categories the caller actually weights: a category at 0% (momentum, by default)
 * contributes nothing to the score, so counting its metrics would inflate the apparent basis of
 * a score they never touched. Inapplicable metrics are already excluded upstream, so a bank's
 * cashGeneration category — entirely inapplicable — contributes to neither side of the ratio
 * rather than dragging it down.
 */
function computeCoverage(categoryScores: CategoryScore[]): ScoreCoverage {
  const scoring = categoryScores.filter((c) => c.weight > 0);
  const metricsIncluded = scoring.reduce((sum, c) => sum + c.metricsIncluded, 0);
  const metricsApplicable = metricsIncluded + scoring.reduce((sum, c) => sum + c.metricsMissing, 0);
  const ratio = metricsApplicable > 0 ? metricsIncluded / metricsApplicable : 0;
  return { metricsIncluded, metricsApplicable, ratio, tier: coverageTierFor(ratio) };
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
 * (winsorize then percentile or z-score, sector-grouped first for
 * sectorRelative metrics), flips direction for "asc" metrics, then combines
 * years using DEFAULT_YEAR_WEIGHTS (35/25/20/10/10), renormalized over
 * whichever years are actually present for that company. Metric scores roll
 * up into category scores (weighted by each metric's verdict-based default,
 * or a caller override), and category scores roll up into the overall score
 * using categoryWeights (renormalized over categories that have data for
 * that company).
 *
 * Metrics that are structurally inapplicable to a company's sector (see
 * sectorApplicability.ts) are skipped for that company and, just as
 * importantly, that company is dropped from those metrics' peer groups — so
 * no one is percentile-ranked against a distribution they were never part
 * of. Each result carries a `coverage` summary of how much of its applicable
 * metric set actually fed the score.
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
  const tickerToSector = new Map(universe.map((c) => [c.ticker, c.sector]));

  const metricUnitScores = new Map<string, Map<number, MetricYearStats>>();

  for (const metric of enabledMetrics) {
    const perYear = new Map<number, MetricYearStats>();
    for (let yearIndex = 0; yearIndex < yearsIncluded; yearIndex++) {
      const entries = universe
        // A company the metric can't describe is left out of the peer group entirely, not just
        // out of its own score — otherwise everyone else's percentile is computed against a
        // distribution that includes values the accounting never supported.
        .filter((c) => isMetricApplicable(metric.key, c.sector))
        .map((c) => ({ ticker: c.ticker, value: c.byYear[yearIndex]?.[metric.key] ?? null }))
        .filter((e): e is { ticker: string; value: number } => e.value !== null && Number.isFinite(e.value));
      if (entries.length < 2) continue;

      const scoreByTicker = new Map<string, number>();
      const rankByTicker = new Map<string, number>();
      const peerCountByTicker = new Map<string, number>();

      const applyGroup = (group: Array<{ ticker: string; value: number }>) => {
        if (group.length < 2) return; // too few peers to rank meaningfully this year — leave missing, not a fabricated rank of 1/1
        const result = computeGroupResult(group, metric, config);
        result.scoreByTicker.forEach((s, t) => scoreByTicker.set(t, s));
        result.rankByTicker.forEach((r, t) => rankByTicker.set(t, r));
        group.forEach((e) => peerCountByTicker.set(e.ticker, result.peerCount));
      };

      if (metric.sectorRelative) {
        const bySector = new Map<string | null, Array<{ ticker: string; value: number }>>();
        for (const e of entries) {
          const sector = tickerToSector.get(e.ticker) ?? null;
          const group = bySector.get(sector);
          if (group) group.push(e);
          else bySector.set(sector, [e]);
        }
        bySector.forEach(applyGroup);
      } else {
        applyGroup(entries);
      }

      perYear.set(yearIndex, { scoreByTicker, rankByTicker, peerCountByTicker });
    }
    metricUnitScores.set(metric.key, perYear);
  }

  const results: RankingResult[] = universe.map(({ ticker, sector, byYear }) => {
    const categoryScores: CategoryScore[] = METRIC_CATEGORIES.map((category: MetricCategory) => {
      const metricsInCategory = enabledMetrics.filter((m) => m.category === category);
      const metricScoresForCompany: Array<{ score: number; weight: number }> = [];
      let missingCount = 0;
      let notApplicableCount = 0;

      for (const metric of metricsInCategory) {
        if (!isMetricApplicable(metric.key, sector)) {
          notApplicableCount++;
          continue;
        }

        const metricWeight = config.metricWeights?.[metric.key] ?? defaultMetricWeight(metric);
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
        metricsNotApplicable: notApplicableCount,
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
      coverage: computeCoverage(categoryScores),
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
