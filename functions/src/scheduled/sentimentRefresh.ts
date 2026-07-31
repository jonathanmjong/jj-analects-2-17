import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { ingestSentimentForUniverse } from "../sentiment/ingestSentiment.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

/** Each ticker is one lightweight search-API call (vs. price history's 2s/ticker gap for a heavier chart pull), so a much larger batch still comfortably fits the timeout. */
const BATCH_SIZE = 300;
const LOCK_DURATION_MS = 20 * 60 * 1000;

const cursorRef = () => db.collection("system").doc("sentimentRefreshCursor");

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
 * Refreshes each company's recent-headline sentiment in checkpointed
 * batches, cycling continuously (same pattern as priceHistoryRefresh) —
 * every few hours rather than hourly, since news volume for most tickers
 * doesn't turn over that fast and this keeps well clear of Yahoo's search
 * endpoint under sustained load.
 */
export const sentimentRefresh = onSchedule(
  { schedule: "every 4 hours", timeoutSeconds: 540, memory: "512MiB" },
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
    const result = await ingestSentimentForUniverse(batch);

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

    log.info(`sentimentRefresh: cycle ${cycleCount}, ${nextCursor}/${tickers.length} refreshed this lap`);
    await logRefresh("sentiment", "yahoo_finance", result, startedAt);
  },
);
