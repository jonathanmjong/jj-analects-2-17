import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { SecEdgarProvider } from "../providers/SecEdgarProvider.js";
import { ingestFundamentalsForTicker, logRefresh } from "../ingestion/ingestFundamentals.js";

const secEdgar = new SecEdgarProvider();

/** Mid-cap floor. Below this, a company isn't part of the ranked universe at all. */
const MID_CAP_FLOOR = 2_000_000_000;
/** Large-cap floor, used only to label marketCapTier — doesn't affect inclusion. */
const LARGE_CAP_FLOOR = 10_000_000_000;

const BATCH_SIZE = 300;
const CONCURRENCY = 5;
const REQUEST_STAGGER_MS = 250;

const cursorRef = () => db.collection("system").doc("universeExpansion");

interface ExpansionState {
  cursor: number;
  totalTickers: number;
  screenedCount: number;
  qualifiedCount: number;
  status: "in_progress" | "complete";
}

async function loadState(totalTickers: number): Promise<ExpansionState> {
  const snap = await cursorRef().get();
  if (!snap.exists) {
    return { cursor: 0, totalTickers, screenedCount: 0, qualifiedCount: 0, status: "in_progress" };
  }
  const data = snap.data() as ExpansionState;
  return { ...data, totalTickers }; // totalTickers can grow slightly between runs as SEC adds filers; always trust the fresh count
}

/**
 * Resumable, checkpointed screen of every SEC-registered ticker (~10,000)
 * against a market-cap floor, so the ranked universe becomes "every mid and
 * large cap company" (data-driven) rather than a hand-picked index list.
 * One SEC EntityPublicFloat lookup per candidate (~1 HTTP call) is cheap
 * enough to screen the whole universe; only names that clear MID_CAP_FLOOR
 * get the full 5-statement ingestion (ingestFundamentalsForTicker, ~2 more
 * calls). Progress is checkpointed in system/universeExpansion so this can
 * run in small batches across many scheduled invocations without ever
 * re-scanning tickers already screened.
 */
export const expandUniverse = onSchedule(
  { schedule: "every 3 minutes", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const allTickers = await secEdgar.listUniverse();
    const state = await loadState(allTickers.length);

    if (state.status === "complete" && state.cursor >= allTickers.length) {
      return; // nothing left to screen
    }

    const batch = allTickers.slice(state.cursor, state.cursor + BATCH_SIZE);
    const succeeded: string[] = [];
    const failed: Array<{ ticker: string; error: string }> = [];
    let qualifiedThisRun = 0;

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const wave = batch.slice(i, i + CONCURRENCY);
      await Promise.all(
        wave.map(async (ticker) => {
          try {
            const approx = await secEdgar.getApproxMarketValue(ticker);
            if (!approx || approx.publicFloat < MID_CAP_FLOOR) {
              succeeded.push(ticker); // successfully screened (just didn't qualify)
              return;
            }
            const result = await ingestFundamentalsForTicker(ticker);
            if (!result.ok) {
              failed.push({ ticker, error: result.error ?? "ingestion failed after qualifying" });
              return;
            }
            await collections.company(ticker).set(
              {
                marketCapTier: approx.publicFloat >= LARGE_CAP_FLOOR ? "large" : "mid",
              },
              { merge: true },
            );
            qualifiedThisRun++;
            succeeded.push(ticker);
          } catch (err) {
            failed.push({ ticker, error: err instanceof Error ? err.message : String(err) });
          }
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, REQUEST_STAGGER_MS));
    }

    const nextCursor = state.cursor + batch.length;
    const done = nextCursor >= allTickers.length;
    await cursorRef().set(
      {
        cursor: nextCursor,
        totalTickers: allTickers.length,
        screenedCount: state.screenedCount + batch.length,
        qualifiedCount: state.qualifiedCount + qualifiedThisRun,
        status: done ? "complete" : "in_progress",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    log.info(
      `expandUniverse: screened ${nextCursor}/${allTickers.length} (+${qualifiedThisRun} qualified this run, ` +
        `${state.qualifiedCount + qualifiedThisRun} total qualified)`,
    );

    await logRefresh("universe_screening", "sec_edgar", { succeeded, failed }, startedAt);
  },
);
