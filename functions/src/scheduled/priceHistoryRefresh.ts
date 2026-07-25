import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { ingestPriceHistoryForUniverse } from "../ingestion/ingestPriceHistory.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

const BATCH_SIZE = 200;
/** How long a claimed lock is honored before being considered abandoned (crashed invocation). */
const LOCK_DURATION_MS = 20 * 60 * 1000;

const cursorRef = () => db.collection("system").doc("priceHistoryRefreshCursor");

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
 * Refreshes each company's ~2-year price history (and the momentum figures
 * derived from it) in checkpointed batches, cycling continuously like
 * dailyPriceRefresh — but hourly rather than every 5 minutes, since momentum
 * is a slower-moving signal and a full history fetch is heavier per ticker
 * than a quote lookup.
 */
export const priceHistoryRefresh = onSchedule(
  { schedule: "every 60 minutes", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const startedAt = new Date().toISOString();
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
    const result = await ingestPriceHistoryForUniverse(batch);

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

    log.info(`priceHistoryRefresh: cycle ${cycleCount}, ${nextCursor}/${tickers.length} refreshed this lap`);
    await logRefresh("price_history", "yahoo_finance", result, startedAt);
  },
);
