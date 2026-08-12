import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { computeForensicFlags, FORENSIC_CHECK_KEYS } from "@proverbs/shared";
import { computeRankings, persistPublicPreview, persistRankings } from "../ranking/rankingEngine.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { collections, db } from "../lib/firestore.js";
import { log } from "../lib/logger.js";

/** Recomputes overall rankings nightly after prices refresh, using the default ranking config. */
export const recomputeRankingsDaily = onSchedule(
  // Timeout covers the ranking job plus the forensic base-rate pass below, which re-reads three
  // statement subcollections per company after the rankings are already persisted.
  { schedule: "every day 23:00", timeZone: "America/New_York", timeoutSeconds: 900, memory: "1GiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const results = await computeRankings(undefined, true);
    await persistRankings(results);
    await persistPublicPreview(results);
    // Best-effort, same rule as persistClientRankingExport: base rates are a presentation aid
    // for the forensic panel, never a precondition of the rankings this job exists to write.
    await persistForensicBaseRates().catch((err) => {
      log.error("recomputeRankingsDaily: persistForensicBaseRates failed, continuing without it", err);
    });
    await logRefresh(
      "rankings",
      "ranking_engine",
      { succeeded: results.map((r) => r.ticker), failed: [] },
      startedAt,
    );
  },
);

/** Three fiscal years is all any forensic check looks back over (two-year margin trend). */
const FORENSIC_PERIODS = 3;
const FORENSIC_CONCURRENCY = 20;

/**
 * Universe-wide trip counts per forensic check, so the company page can caption each flag with
 * how ordinary it is ("18% of covered companies also trip this") instead of presenting every
 * flag as if it were rare. Runs as its own pass rather than inside computeRankings because the
 * ranking engine only loads precomputed metricScores — it never has the raw statements the
 * forensic checks read.
 *
 * The denominator is companies where at least one check was computable, not the whole universe:
 * a company with no usable statements is uncovered, not clean.
 */
async function persistForensicBaseRates(): Promise<void> {
  const companiesSnap = await collections.companies().get();
  const tripped = new Map<string, number>();
  let totalCompanies = 0;

  for (let i = 0; i < companiesSnap.docs.length; i += FORENSIC_CONCURRENCY) {
    const batch = companiesSnap.docs.slice(i, i + FORENSIC_CONCURRENCY);
    const reports = await Promise.all(
      batch.map(async (doc) => {
        const symbol = doc.id;
        const [incomeSnap, balanceSnap, cashFlowSnap] = await Promise.all([
          collections.incomeStatements(symbol).orderBy("fiscalYear", "desc").limit(FORENSIC_PERIODS).get(),
          collections.balanceSheets(symbol).orderBy("fiscalYear", "desc").limit(FORENSIC_PERIODS).get(),
          collections.cashFlowStatements(symbol).orderBy("fiscalYear", "desc").limit(FORENSIC_PERIODS).get(),
        ]);
        if (incomeSnap.empty && balanceSnap.empty && cashFlowSnap.empty) return null;

        return computeForensicFlags({
          income: incomeSnap.docs.map((d) => d.data() as IncomeStatement),
          balance: balanceSnap.docs.map((d) => d.data() as BalanceSheet),
          cashFlow: cashFlowSnap.docs.map((d) => d.data() as CashFlowStatement),
          marketCap: (doc.get("latest.marketCap") as number | null | undefined) ?? null,
          sector: (doc.get("sector") as string | null | undefined) ?? null,
        });
      }),
    );

    for (const report of reports) {
      if (report === null || report.checkedCount === 0) continue;
      totalCompanies++;
      for (const flag of report.flags) {
        tripped.set(flag.key, (tripped.get(flag.key) ?? 0) + 1);
      }
    }
  }

  const rates: Record<string, { tripped: number; pct: number }> = {};
  for (const key of FORENSIC_CHECK_KEYS) {
    const count = tripped.get(key) ?? 0;
    rates[key] = {
      tripped: count,
      pct: totalCompanies > 0 ? Math.round((count / totalCompanies) * 1000) / 10 : 0,
    };
  }

  await db.collection("system").doc("forensicBaseRates").set({
    asOf: new Date().toISOString(),
    totalCompanies,
    rates,
  });
  log.info(`persistForensicBaseRates: ${totalCompanies} covered companies`);
}

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
