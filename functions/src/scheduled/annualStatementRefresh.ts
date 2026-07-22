import { onSchedule } from "firebase-functions/v2/scheduler";
import { collections } from "../lib/firestore.js";
import { ingestFundamentalsForUniverse, logRefresh } from "../ingestion/ingestFundamentals.js";
import { STATEMENT_PROVIDER } from "../providers/index.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

/**
 * Deep annual sweep: re-pulls the full 5-year statement history (not just
 * the latest period) for every company, to backfill any restatements or
 * fields SEC EDGAR added since the last full pull. Runs monthly since 10-K
 * filing dates are staggered across fiscal year-ends.
 */
export const annualStatementRefresh = onSchedule(
  { schedule: "1 of month 05:00", timeZone: "America/New_York", timeoutSeconds: 1800, memory: "1GiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const companiesSnap = await collections.companies().get();
    const tickers = companiesSnap.empty ? SEED_UNIVERSE : companiesSnap.docs.map((d) => d.id);
    const result = await ingestFundamentalsForUniverse(tickers);
    await logRefresh("annual_statements", STATEMENT_PROVIDER, result, startedAt);
  },
);
