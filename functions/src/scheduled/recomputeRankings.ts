import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import { computeRankings, persistRankings } from "../ranking/rankingEngine.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";

/** Recomputes overall rankings nightly after prices refresh, using the default ranking config. */
export const recomputeRankingsDaily = onSchedule(
  { schedule: "every day 23:00", timeZone: "America/New_York", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const results = await computeRankings(undefined, true);
    await persistRankings(results);
    await logRefresh(
      "rankings",
      "ranking_engine",
      { succeeded: results.map((r) => r.ticker), failed: [] },
      startedAt,
    );
  },
);

/**
 * On-demand recompute with a custom weights config, used by the frontend's
 * live weight sliders. Read-only (no persistRankings/persistMetricScores),
 * but still loads metricScores for the whole universe (~1,300+ companies x
 * up to 5 periods) — the default onCall memory/timeout (256MiB/60s) is
 * comfortably undersized for that at current universe scale, so this
 * mirrors recomputeRankingsDaily's resource config rather than silently
 * OOMing or timing out on every call.
 */
export const recomputeRankingsWithConfig = onCall({ timeoutSeconds: 120, memory: "1GiB" }, async (request) => {
  const config = request.data?.config;
  const results = await computeRankings(config);
  return { results };
});
