import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { ingestValuationHistoryForUniverse } from "../ingestion/ingestValuationHistory.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

/**
 * A company's valuation history only changes when it files its next 10-K —
 * once a year, staggered across fiscal calendars. Weekly is already far more
 * often than the data moves; the batch is sized so a full universe lap takes
 * ~4 weeks rather than to finish fast, keeping this job's load on EDGAR low
 * (2 requests per company).
 */
const BATCH_SIZE = 400;
/** How long a claimed lock is honored before being considered abandoned (crashed invocation). */
const LOCK_DURATION_MS = 30 * 60 * 1000;

const cursorRef = () => db.collection("system").doc("valuationHistoryRefreshCursor");

interface RefreshState {
  cursor: number;
  cycleCount: number;
  lockedUntil?: number;
}

async function claimLock(): Promise<RefreshState | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(cursorRef());
    const state: RefreshState = snap.exists ? (snap.data() as RefreshState) : { cursor: 0, cycleCount: 0 };
    if (state.lockedUntil && state.lockedUntil > Date.now()) return null;
    tx.set(cursorRef(), { ...state, lockedUntil: Date.now() + LOCK_DURATION_MS }, { merge: true });
    return state;
  });
}

/**
 * Backfills each company's own valuation history (12 fiscal years of
 * 10-K cover-page public float joined to that year's fundamentals) in
 * checkpointed batches, cycling continuously like priceHistoryRefresh.
 */
export const valuationHistoryRefresh = onSchedule(
  { schedule: "every sunday 04:00", timeZone: "America/New_York", timeoutSeconds: 1800, memory: "1GiB" },
  async () => {
    const state = await claimLock();
    if (!state) return; // another invocation is already running

    const companiesSnap = await collections.companies().get();
    const tickers = companiesSnap.empty ? SEED_UNIVERSE : companiesSnap.docs.map((d) => d.id);

    let cursor = state.cursor;
    let cycleCount = state.cycleCount;
    if (cursor >= tickers.length) {
      cursor = 0;
      cycleCount += 1;
    }

    const batch = tickers.slice(cursor, cursor + BATCH_SIZE);
    const result = await ingestValuationHistoryForUniverse(batch);

    const nextCursor = cursor + batch.length;
    await cursorRef().set(
      {
        cursor: nextCursor,
        cycleCount,
        totalTickers: tickers.length,
        lockedUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    log.info(
      `valuationHistoryRefresh: cycle ${cycleCount}, ${nextCursor}/${tickers.length} refreshed this lap ` +
        `(${result.succeeded.length} ok, ${result.failed.length} failed)`,
    );
  },
);
