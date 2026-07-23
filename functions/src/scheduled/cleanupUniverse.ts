import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { computeRankings, persistRankings } from "../ranking/rankingEngine.js";

/** Deletes a company doc and every subcollection under it. */
async function deleteCompanyCascade(ticker: string): Promise<void> {
  const subcollections = [
    collections.incomeStatements(ticker),
    collections.balanceSheets(ticker),
    collections.cashFlowStatements(ticker),
    collections.metricScores(ticker),
    collections.marketData(ticker),
    collections.historicalMetrics(ticker),
  ];
  for (const col of subcollections) {
    const snap = await col.get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }

  const historicalSnaps = await collections.historicalRankings(ticker).get();
  if (!historicalSnaps.empty) {
    const batch = db.batch();
    historicalSnaps.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  await Promise.all([
    collections.company(ticker).delete(),
    collections.rankingsLatest().doc(ticker).delete(),
  ]);
}

function pickPrimaryTicker(tickers: string[]): string {
  // Prefer a ticker with no suffix (no "-", ".", or digit-heavy variant
  // marker) — that's almost always the primary common-stock listing rather
  // than a preferred series or secondary share class.
  const clean = tickers.filter((t) => !/[-.]/.test(t));
  const pool = clean.length > 0 ? clean : tickers;
  return pool.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * Data-quality sweep over the already-ingested universe:
 *  1. Same-CIK duplicates (dual-class shares, preferred stock series that
 *     predate the dedup check added to expandUniverse) — keep one ticker
 *     per CIK, delete the rest.
 *  2. Non-operating entities (ETFs, trusts, funds) that filed
 *     EntityPublicFloat but have no real Revenues/NetIncomeLoss history —
 *     shouldn't be ranked alongside operating companies.
 * Safe to run repeatedly (idempotent) — scheduled as an ongoing guard, not
 * just a one-off migration, since SEC could add new same-CIK tickers later.
 */
export const cleanupUniverse = onSchedule(
  { schedule: "every 24 hours", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const companiesSnap = await collections.companies().get();

    const byCik = new Map<string, string[]>();
    for (const doc of companiesSnap.docs) {
      const cik = doc.get("cik") as string | null;
      if (!cik) continue;
      const existing = byCik.get(cik);
      if (existing) existing.push(doc.id);
      else byCik.set(cik, [doc.id]);
    }

    const toDelete = new Set<string>();
    let duplicateGroups = 0;
    for (const [, tickers] of byCik) {
      if (tickers.length <= 1) continue;
      duplicateGroups++;
      const primary = pickPrimaryTicker(tickers);
      for (const t of tickers) {
        if (t !== primary) toDelete.add(t);
      }
    }

    let nonOperatingCount = 0;
    for (const doc of companiesSnap.docs) {
      if (toDelete.has(doc.id)) continue; // already flagged as a duplicate
      const incomeSnap = await collections.incomeStatements(doc.id).limit(5).get();
      // Revenue specifically, not netIncome — investment vehicles (ETFs,
      // trusts) commonly report net income from fund holdings but not
      // revenue-from-customers. See SecEdgarProvider.hasOperatingFinancials.
      const hasRealFinancials = incomeSnap.docs.some((d) => d.data().revenue !== null);
      if (!hasRealFinancials) {
        toDelete.add(doc.id);
        nonOperatingCount++;
      }
    }

    for (const ticker of toDelete) {
      await deleteCompanyCascade(ticker);
    }

    log.info(
      `cleanupUniverse: removed ${toDelete.size} companies (${duplicateGroups} duplicate CIK groups, ` +
        `${nonOperatingCount} non-operating entities)`,
    );

    await logRefresh(
      "universe_screening",
      "cleanup",
      { succeeded: [...toDelete], failed: [] },
      startedAt,
    );

    if (toDelete.size > 0) {
      const results = await computeRankings();
      await persistRankings(results);
    }
  },
);
