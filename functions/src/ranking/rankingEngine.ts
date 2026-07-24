import type { CategoryScore, HeadlineMetrics, MetricCategory, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG, DEFAULT_YEAR_WEIGHTS, METRIC_CATEGORIES } from "@proverbs/shared";
import { collections, db } from "../lib/firestore.js";
import { METRIC_DEFINITIONS } from "../metrics/definitions.js";
import { percentileRanks, weightedAverage, winsorize, zscoreToUnitScore, zscores } from "./normalize.js";

interface CompanyYearScores {
  ticker: string;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
  /** Parallel to byYear — the metricScores doc id (periodKey) each entry came from. */
  periodKeys: string[];
}

async function loadUniverseRawScores(tickers: string[]): Promise<CompanyYearScores[]> {
  const results = await Promise.all(
    tickers.map(async (ticker) => {
      const snap = await collections.metricScores(ticker).orderBy("periodKey", "desc").limit(5).get();
      const byYear = snap.docs.map((doc) => {
        const data = doc.data() as { scores: Record<string, { rawValue: number | null; isMissing: boolean }> };
        const values: Record<string, number | null> = {};
        for (const [key, score] of Object.entries(data.scores ?? {})) {
          values[key] = score.isMissing ? null : score.rawValue;
        }
        return values;
      });
      const periodKeys = snap.docs.map((doc) => doc.id);
      return { ticker, byYear, periodKeys };
    }),
  );
  return results;
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

interface MetricYearStats {
  /** ticker -> direction-adjusted unit score (0-1, higher always means "better performing"). */
  scoreByTicker: Map<string, number>;
  /** ticker -> rank among peers for this metric+year, 1 = best. */
  rankByTicker: Map<string, number>;
  peerCount: number;
}

/**
 * Cross-sectional ranking engine. For each metric x fiscal-year-index,
 * normalizes raw values across every company that has one (winsorize then
 * percentile or z-score), flips direction for "asc" metrics, then combines
 * years using DEFAULT_YEAR_WEIGHTS (35/25/20/10/10), renormalized over
 * whichever years are actually present for that company. Metric scores roll
 * up into category scores (equal-weighted across available metrics), and
 * category scores roll up into the overall score using categoryWeights
 * (renormalized over categories that have data for that company).
 *
 * When `persistMetricScores` is true, also writes each metric's percentile
 * + rank-among-peers back onto companies/{ticker}/metricScores/{periodKey}
 * (merged into the existing rawValue/isMissing fields) — this is what lets
 * the Company page show percentile/rank per metric per year, not just the
 * raw value. Only the scheduled jobs set this to true; the on-demand
 * custom-weights preview (recomputeRankingsWithConfig) leaves it false
 * since that's an ephemeral "what if" computation, not the system of record.
 */
export async function computeRankings(
  config: RankingWeightsConfig = DEFAULT_RANKING_CONFIG,
  persistMetricScores = false,
): Promise<RankingResult[]> {
  const companiesSnap = await collections.companies().get();
  const tickers = companiesSnap.docs.map((d) => d.id);
  const universe = await loadUniverseRawScores(tickers);

  const yearsIncluded = config.yearsIncluded;
  const enabledMetrics = METRIC_DEFINITIONS.filter((m) => m.enabled);

  // metricKey -> yearIndex -> per-metric-year cross-sectional stats
  const metricUnitScores = new Map<string, Map<number, MetricYearStats>>();

  for (const metric of enabledMetrics) {
    const perYear = new Map<number, MetricYearStats>();
    for (let yearIndex = 0; yearIndex < yearsIncluded; yearIndex++) {
      const entries = universe
        .map((c) => ({ ticker: c.ticker, value: c.byYear[yearIndex]?.[metric.key] ?? null }))
        .filter((e): e is { ticker: string; value: number } => e.value !== null && Number.isFinite(e.value));
      if (entries.length < 2) continue;

      const raw = entries.map((e) => e.value);
      const winsorized = winsorize(raw, config.winsorizeLowerPct, config.winsorizeUpperPct);
      const normalized =
        config.normalizationMethod === "percentile"
          ? percentileRanks(winsorized)
          : zscores(winsorized).map(zscoreToUnitScore);

      const scoreByTicker = new Map<string, number>();
      entries.forEach((e, idx) => {
        const score = metric.direction === "asc" ? 1 - normalized[idx] : normalized[idx];
        scoreByTicker.set(e.ticker, score);
      });

      const rankByTicker = new Map<string, number>();
      [...scoreByTicker.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([ticker], idx) => rankByTicker.set(ticker, idx + 1));

      perYear.set(yearIndex, { scoreByTicker, rankByTicker, peerCount: entries.length });
    }
    metricUnitScores.set(metric.key, perYear);
  }

  const results: RankingResult[] = universe.map(({ ticker, byYear }) => {
    const categoryScores: CategoryScore[] = METRIC_CATEGORIES.map((category) => {
      const metricsInCategory = enabledMetrics.filter((m) => m.category === category);
      // (multi-year score, user-configurable relative weight) per metric that has data — a
      // weight of 0 (explicitly set via config.metricWeights) excludes the metric entirely,
      // same as if it were missing.
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
      peerCount: tickers.length,
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

  if (persistMetricScores) {
    await persistMetricPercentiles(universe, metricUnitScores, enabledMetrics.map((m) => m.key));
  }

  return results;
}

/**
 * Writes each metric's percentile (direction-adjusted, 0-1, higher = better)
 * and rank-among-peers back onto the per-company, per-fiscal-year
 * metricScores docs that computeMetricsForCompany already created, merging
 * so rawValue/isMissing are untouched.
 */
async function persistMetricPercentiles(
  universe: CompanyYearScores[],
  metricUnitScores: Map<string, Map<number, MetricYearStats>>,
  metricKeys: string[],
): Promise<void> {
  const writes: Array<{ ticker: string; periodKey: string; scores: Record<string, unknown> }> = [];

  for (const { ticker, periodKeys } of universe) {
    for (let yearIndex = 0; yearIndex < periodKeys.length; yearIndex++) {
      const periodKey = periodKeys[yearIndex];
      const scoresUpdate: Record<string, unknown> = {};
      let hasAnyUpdate = false;

      for (const metricKey of metricKeys) {
        const stats = metricUnitScores.get(metricKey)?.get(yearIndex);
        const percentile = stats?.scoreByTicker.get(ticker);
        if (percentile === undefined) continue;
        scoresUpdate[metricKey] = {
          percentile,
          rankAmongPeers: stats!.rankByTicker.get(ticker) ?? null,
          peerCount: stats!.peerCount,
        };
        hasAnyUpdate = true;
      }

      if (hasAnyUpdate) writes.push({ ticker, periodKey, scores: scoresUpdate });
    }
  }

  // Each doc here carries ~70 metrics' worth of {percentile, rankAmongPeers,
  // peerCount}, much chunkier than persistRankings' small per-ticker
  // summaries — 400/batch tripped Firestore's "Transaction too big" limit
  // in production, so this uses a much smaller batch size.
  const batchSize = 75;
  for (let i = 0; i < writes.length; i += batchSize) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + batchSize)) {
      batch.set(collections.metricScores(w.ticker).doc(w.periodKey), { scores: w.scores }, { merge: true });
    }
    await batch.commit();
  }
}

export async function persistRankings(results: RankingResult[]): Promise<void> {
  const batchSize = 400;
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = db.batch();
    for (const result of results.slice(i, i + batchSize)) {
      batch.set(collections.rankingsLatest().doc(result.ticker), result);
      batch.set(collections.historicalRankings(result.ticker).doc(result.computedAt.slice(0, 10)), {
        date: result.computedAt.slice(0, 10),
        overallScore: result.overallScore,
        overallRank: result.overallRank,
      });
      batch.set(
        collections.company(result.ticker),
        {
          latest: {
            overallScore: result.overallScore,
            overallRank: result.overallRank,
            headlineMetrics: result.headlineMetrics,
          },
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}
