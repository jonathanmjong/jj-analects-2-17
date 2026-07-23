import { onSchedule } from "firebase-functions/v2/scheduler";
import { collections } from "../lib/firestore.js";
import { ingestFundamentalsForUniverse, logRefresh } from "../ingestion/ingestFundamentals.js";
import { STATEMENT_PROVIDER } from "../providers/index.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";
import { computeRankings, persistRankings } from "../ranking/rankingEngine.js";

/**
 * Runs weekly rather than "on a quarterly cadence" because most 10-Qs post
 * within a rolling window, not all on the same calendar day — the weekly
 * sweep re-pulls each company's latest available statements and is a no-op
 * (merge write) for companies with nothing new since their last filing.
 */
export const quarterlyStatementRefresh = onSchedule(
  { schedule: "every monday 06:00", timeZone: "America/New_York", timeoutSeconds: 1800, memory: "1GiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const companiesSnap = await collections.companies().get();
    const tickers = companiesSnap.empty ? SEED_UNIVERSE : companiesSnap.docs.map((d) => d.id);
    const result = await ingestFundamentalsForUniverse(tickers);
    await logRefresh("quarterly_statements", STATEMENT_PROVIDER, result, startedAt);

    const rankings = await computeRankings(undefined, true);
    await persistRankings(rankings);
  },
);
