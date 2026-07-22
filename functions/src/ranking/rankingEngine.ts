import type { CategoryScore, MetricCategory, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG, DEFAULT_YEAR_WEIGHTS, METRIC_CATEGORIES } from "@proverbs/shared";
import { collections, db } from "../lib/firestore.js";
import { METRIC_DEFINITIONS } from "../metrics/definitions.js";
import { percentileRanks, winsorize, zscoreToUnitScore, zscores } from "./normalize.js";

interface CompanyYearScores {
  ticker: string;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
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
      return { ticker, byYear };
    }),
  );
  return results;
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
 */
export async function computeRankings(
  config: RankingWeightsConfig = DEFAULT_RANKING_CONFIG,
): Promise<RankingResult[]> {
  const companiesSnap = await collections.companies().get();
  const tickers = companiesSnap.docs.map((d) => d.id);
  const universe = await loadUniverseRawScores(tickers);

  const yearsIncluded = config.yearsIncluded;
  const enabledMetrics = METRIC_DEFINITIONS.filter((m) => m.enabled);

  // metricKey -> yearIndex -> ticker -> unitScore (0-1, higher already means "better")
  const metricUnitScores = new Map<string, Map<number, Map<string, number>>>();

  for (const metric of enabledMetrics) {
    const perYear = new Map<number, Map<string, number>>();
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

      const tickerScores = new Map<string, number>();
      entries.forEach((e, idx) => {
        const score = metric.direction === "asc" ? 1 - normalized[idx] : normalized[idx];
        tickerScores.set(e.ticker, score);
      });
      perYear.set(yearIndex, tickerScores);
    }
    metricUnitScores.set(metric.key, perYear);
  }

  const results: RankingResult[] = universe.map(({ ticker }) => {
    const categoryScores: CategoryScore[] = METRIC_CATEGORIES.map((category) => {
      const metricsInCategory = enabledMetrics.filter((m) => m.category === category);
      const metricScoresForCompany: number[] = [];
      let missingCount = 0;

      for (const metric of metricsInCategory) {
        const perYear = metricUnitScores.get(metric.key);
        if (!perYear) {
          missingCount++;
          continue;
        }
        const availableYearScores: Array<{ weight: number; score: number }> = [];
        for (let yearIndex = 0; yearIndex < yearsIncluded; yearIndex++) {
          const score = perYear.get(yearIndex)?.get(ticker);
          if (score === undefined) continue;
          availableYearScores.push({ weight: DEFAULT_YEAR_WEIGHTS[yearIndex] ?? 0, score });
        }
        if (availableYearScores.length === 0) {
          missingCount++;
          continue;
        }
        const weightSum = availableYearScores.reduce((a, b) => a + b.weight, 0);
        const multiYearScore =
          weightSum > 0
            ? availableYearScores.reduce((acc, y) => acc + (y.weight / weightSum) * y.score, 0)
            : availableYearScores.reduce((acc, y) => acc + y.score, 0) / availableYearScores.length;
        metricScoresForCompany.push(multiYearScore);
      }

      const categoryScore =
        metricScoresForCompany.length > 0
          ? metricScoresForCompany.reduce((a, b) => a + b, 0) / metricScoresForCompany.length
          : null;

      return {
        category,
        score: categoryScore,
        weight: config.categoryWeights[category],
        metricsIncluded: metricScoresForCompany.length,
        metricsMissing: missingCount,
      };
    });

    const availableCategories = categoryScores.filter((c) => c.score !== null && c.weight > 0);
    const weightSum = availableCategories.reduce((a, c) => a + c.weight, 0);
    const overallScore =
      weightSum > 0
        ? availableCategories.reduce((acc, c) => acc + ((c.weight / weightSum) * (c.score as number)), 0) * 100
        : null;

    return {
      ticker,
      computedAt: new Date().toISOString(),
      overallScore,
      overallRank: null,
      peerCount: tickers.length,
      categoryScores,
      weightsUsed: config,
    };
  });

  const ranked = results
    .filter((r) => r.overallScore !== null)
    .sort((a, b) => (b.overallScore as number) - (a.overallScore as number));
  ranked.forEach((r, idx) => {
    r.overallRank = idx + 1;
  });

  return results;
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
          },
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}
