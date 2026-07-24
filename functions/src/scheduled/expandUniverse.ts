import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { SecEdgarProvider } from "../providers/SecEdgarProvider.js";
import { ingestFundamentalsForTicker, logRefresh } from "../ingestion/ingestFundamentals.js";
import { isPlausibleMarketCap } from "../ingestion/ingestPrices.js";

const secEdgar = new SecEdgarProvider();

/** Mid-cap floor. Below this, a company isn't part of the ranked universe at all. */
const MID_CAP_FLOOR = 2_000_000_000;
/** Large-cap floor, used only to label marketCapTier — doesn't affect inclusion. */
const LARGE_CAP_FLOOR = 10_000_000_000;

const BATCH_SIZE = 150;
const CONCURRENCY = 5;
const REQUEST_STAGGER_MS = 250;
/** How long a claimed lock is honored before being considered abandoned (crashed invocation). */
const LOCK_DURATION_MS = 8 * 60 * 1000;

const cursorRef = () => db.collection("system").doc("universeExpansion");

interface ExpansionState {
  cursor: number;
  totalTickers: number;
  screenedCount: number;
  qualifiedCount: number;
  status: "in_progress" | "complete";
  lockedUntil?: number;
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
 * Claims the expansion lock in a transaction so overlapping invocations
 * (the schedule can fire again before a slow batch finishes) don't race on
 * the same cursor and double up SEC EDGAR requests. Returns null if another
 * invocation currently holds a live lock.
 */
async function claimLock(totalTickers: number): Promise<ExpansionState | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(cursorRef());
    const state: ExpansionState = snap.exists
      ? { ...(snap.data() as ExpansionState), totalTickers }
      : { cursor: 0, totalTickers, screenedCount: 0, qualifiedCount: 0, status: "in_progress" };

    if (state.status === "complete" && state.cursor >= totalTickers) return null;
    if (state.lockedUntil && state.lockedUntil > Date.now()) return null; // another invocation is actively running

    tx.set(cursorRef(), { ...state, lockedUntil: Date.now() + LOCK_DURATION_MS }, { merge: true });
    return state;
  });
}

/**
 * Resumable, checkpointed screen of every SEC-registered ticker (~10,000)
 * against a market-cap floor, so the ranked universe becomes "every mid and
 * large cap company" (data-driven) rather than a hand-picked index list.
 * One SEC EntityPublicFloat lookup per candidate (~1 HTTP call) is cheap
 * enough to screen the whole universe; only names that clear MID_CAP_FLOOR
 * get the full 5-statement ingestion (ingestFundamentalsForTicker, ~2 more
 * calls). Progress is checkpointed in system/universeExpansion, guarded by
 * a short-lived lock, so this runs in small batches across many scheduled
 * invocations without re-scanning tickers or racing itself if a batch runs
 * long enough to overlap the next scheduled tick.
 */
export const expandUniverse = onSchedule(
  { schedule: "every 5 minutes", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const allTickers = await secEdgar.listUniverse();
    const state = await claimLock(allTickers.length);
    if (!state) return; // complete, or another invocation is already running this batch

    // Many tickers in SEC's list share a CIK — dual-class common stock,
    // preferred stock series, etc. Track CIKs already represented in the
    // universe so a company is counted once, under a single ticker, not
    // once per share class/series.
    const existingCiks = new Set<string>();
    const existingSnap = await collections.companies().select("cik").get();
    for (const doc of existingSnap.docs) {
      const cik = doc.get("cik") as string | null;
      if (cik) existingCiks.add(cik);
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
            if (
              !approx ||
              approx.publicFloat < MID_CAP_FLOOR ||
              !isPlausibleMarketCap(approx.publicFloat, approx.latestRevenue) ||
              !approx.hasOperatingFinancials
            ) {
              succeeded.push(ticker); // screened successfully (didn't qualify, isn't an operating company, or the filer's own XBRL data is implausible)
              return;
            }
            // Synchronous check-then-reserve (no await in between) so two
            // same-CIK tickers landing in the same concurrent wave can't
            // both slip past this gate.
            if (existingCiks.has(approx.cik)) {
              succeeded.push(ticker); // duplicate share class/series of an already-qualified company
              return;
            }
            existingCiks.add(approx.cik);

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
        lockedUntil: FieldValue.delete(),
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
