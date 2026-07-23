import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { ingestPricesForUniverse } from "../ingestion/ingestPrices.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { PRICE_PROVIDER } from "../providers/index.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

const BATCH_SIZE = 400;
/** How long a claimed lock is honored before being considered abandoned (crashed invocation). */
const LOCK_DURATION_MS = 8 * 60 * 1000;

const cursorRef = () => db.collection("system").doc("priceRefreshCursor");

interface RefreshState {
  cursor: number;
  cycleCount: number;
  lockedUntil?: number;
}

/**
 * Claims the refresh lock in a transaction so overlapping invocations don't
 * race on the same cursor. Returns null if another invocation currently
 * holds a live lock.
 */
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
 * Refreshes prices for the whole universe in checkpointed batches rather
 * than one pass over every company — at universe-screening scale
 * (~2,000 companies, one sequential Yahoo/SEC-fallback request each) a
 * single invocation can't reliably finish inside the 540s function timeout.
 * Cursor wraps back to 0 once a full cycle completes, so this behaves as a
 * continuously-refreshing cycle (a company gets a new quote roughly once
 * per full lap) rather than a strict once-daily job — a reasonable
 * trade-off given the universe size is data-driven and keeps growing.
 */
export const dailyPriceRefresh = onSchedule(
  { schedule: "every 5 minutes", timeoutSeconds: 540, memory: "512MiB" },
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
    const result = await ingestPricesForUniverse(batch);

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

    log.info(`dailyPriceRefresh: cycle ${cycleCount}, ${nextCursor}/${tickers.length} refreshed this lap`);
    await logRefresh("prices", PRICE_PROVIDER, result, startedAt);
  },
);
