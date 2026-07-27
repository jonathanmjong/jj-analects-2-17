import type { MetricYearStats, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { computeCrossSectionalRankings, DEFAULT_RANKING_CONFIG } from "@proverbs/shared";
import { collections, db } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { METRIC_DEFINITIONS } from "../metrics/definitions.js";
import { persistClientRankingExport, type CompanyYearScores } from "./exportUniverseData.js";

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

/**
 * Cross-sectional ranking engine. Loads the universe's raw metric values from
 * Firestore, then delegates the actual math to
 * shared/src/rankingEngineCore.ts's computeCrossSectionalRankings (the exact
 * same implementation the Rankings page runs client-side for instant
 * live-reweighting, against a bulk export produced by
 * persistClientRankingExport below).
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

  const enabledMetrics = METRIC_DEFINITIONS.filter((m) => m.enabled);
  const { results, metricUnitScores } = computeCrossSectionalRankings(universe, METRIC_DEFINITIONS, config);

  if (persistMetricScores) {
    const metricKeys = enabledMetrics.map((m) => m.key);
    // Best-effort: the client-side-recompute export is a performance optimization, not the
    // system of record. A failure here (e.g. Storage misconfigured) must never prevent the
    // nightly job from persisting the actual rankings below it. Independent of
    // persistMetricPercentiles (both only read universe/metricUnitScores), so run it
    // concurrently instead of adding its full duration to the job's sequential critical path.
    const exportDone = persistClientRankingExport(universe, metricKeys).catch((err) => {
      log.error("computeRankings: persistClientRankingExport failed, continuing without it", err);
    });
    await persistMetricPercentiles(universe, metricUnitScores, metricKeys);
    await exportDone;
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

/**
 * Writes a small, public-readable preview (top 20 by rank, name + sector +
 * score only — no metric breakdown) for the marketing site's no-signup
 * preview page. firestore.rules carves out rankings/preview specifically as
 * the one document anonymous visitors can read; everything else in
 * `rankings` stays behind the subscribed-only rule.
 */
export async function persistPublicPreview(results: RankingResult[]): Promise<void> {
  const top20 = results
    .filter((r) => r.overallRank !== null && r.overallRank <= 20)
    .sort((a, b) => (a.overallRank as number) - (b.overallRank as number));
  if (top20.length === 0) return;

  const companySnaps = await Promise.all(top20.map((r) => collections.company(r.ticker).get()));
  const companies = top20.map((r, i) => {
    const data = companySnaps[i].data();
    return {
      ticker: r.ticker,
      companyName: (data?.companyName as string | undefined) ?? r.ticker,
      sector: (data?.sector as string | null | undefined) ?? null,
      overallScore: r.overallScore,
      overallRank: r.overallRank,
    };
  });

  await db.collection("rankings").doc("preview").set({ companies, updatedAt: new Date().toISOString() });
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
