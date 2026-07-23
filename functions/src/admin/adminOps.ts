import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ingestFundamentalsForUniverse, logRefresh } from "../ingestion/ingestFundamentals.js";
import { ingestPricesForUniverse } from "../ingestion/ingestPrices.js";
import { STATEMENT_PROVIDER, PRICE_PROVIDER } from "../providers/index.js";
import { SEED_UNIVERSE } from "../ingestion/universe.js";
import { computeRankings, persistRankings } from "../ranking/rankingEngine.js";
import { METRIC_DEFINITIONS } from "../metrics/definitions.js";
import { collections, db } from "../lib/firestore.js";

const ADMIN_EMAILS = ["jonathanmjong@gmail.com"];

function assertAdmin(request: { auth?: { token: { email?: string } } | null }): void {
  const email = request.auth?.token.email;
  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

async function seedDefinitions(): Promise<{ count: number }> {
  const batch = db.batch();
  for (const def of METRIC_DEFINITIONS) {
    batch.set(collections.metricDefinitions().doc(def.key), def);
  }
  await batch.commit();
  return { count: METRIC_DEFINITIONS.length };
}

/**
 * One-shot bootstrap: seeds metric definitions, pulls fundamentals + prices
 * for the seed universe, and runs the ranking engine, so the app has real
 * data before the first scheduled job fires.
 */
async function runBootstrap() {
  const startedAt = new Date().toISOString();
  await seedDefinitions();

  const statementResult = await ingestFundamentalsForUniverse(SEED_UNIVERSE);
  await logRefresh("annual_statements", STATEMENT_PROVIDER, statementResult, startedAt);

  const priceResult = await ingestPricesForUniverse(SEED_UNIVERSE);
  await logRefresh("prices", PRICE_PROVIDER, priceResult, startedAt);

  const rankings = await computeRankings(undefined, true);
  await persistRankings(rankings);

  return {
    statements: statementResult,
    prices: priceResult,
    rankedCompanies: rankings.filter((r) => r.overallScore !== null).length,
  };
}

export const seedMetricDefinitions = onCall(async (request) => {
  assertAdmin(request);
  return seedDefinitions();
});

export const bootstrapSeedUniverse = onCall({ timeoutSeconds: 1800, memory: "1GiB" }, async (request) => {
  assertAdmin(request);
  return runBootstrap();
});
