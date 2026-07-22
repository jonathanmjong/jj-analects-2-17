import { onSchedule } from "firebase-functions/v2/scheduler";
import { collections } from "../lib/firestore.js";
import { ingestPricesForUniverse } from "../ingestion/ingestPrices.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";
import { PRICE_PROVIDER } from "../providers/index.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";

export const dailyPriceRefresh = onSchedule(
  { schedule: "every day 22:00", timeZone: "America/New_York", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const startedAt = new Date().toISOString();
    const companiesSnap = await collections.companies().get();
    const tickers = companiesSnap.empty ? SEED_UNIVERSE : companiesSnap.docs.map((d) => d.id);
    const result = await ingestPricesForUniverse(tickers);
    await logRefresh("prices", PRICE_PROVIDER, result, startedAt);
  },
);
