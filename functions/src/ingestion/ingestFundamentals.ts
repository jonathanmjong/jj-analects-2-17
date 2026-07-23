import type { Company } from "@proverbs/shared";
import { collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { SecEdgarProvider } from "../providers/SecEdgarProvider.js";
import { computeMetricsForCompany } from "../metrics/computeMetrics.js";

const STATEMENT_YEARS = 5;

// getCompanyBundle() is SEC-EDGAR-specific (not part of the swappable
// FinancialDataProvider interface) — it exists specifically to fetch
// statements + profile + approx market value in 2 HTTP calls instead of 5,
// which matters at universe scale. See SecEdgarProvider's class doc comment.
const secEdgar = new SecEdgarProvider();

/**
 * Pulls company profile + up to 5 years of income/balance/cash-flow
 * statements for one ticker, writes them to Firestore, then recomputes that
 * company's per-period metric values. Called by both the on-demand callable
 * and the quarterly/annual scheduled refresh jobs.
 */
export async function ingestFundamentalsForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const bundle = await secEdgar.getCompanyBundle(symbol, STATEMENT_YEARS);
    if (!bundle) return { ok: false, error: "no SEC EDGAR data (unknown ticker or no filings)" };
    const { profile, income, balance, cashFlow } = bundle;

    const now = new Date().toISOString();
    const companyRef = collections.company(symbol);
    const existing = await companyRef.get();

    const companyDoc: Partial<Company> = {
      ticker: symbol,
      companyName: profile.companyName,
      cik: profile.cik,
      sector: profile.sector as Company["sector"],
      industry: profile.industry,
      description: profile.description,
      website: profile.website,
      country: profile.country,
      updatedAt: now,
    };
    if (!existing.exists) {
      companyDoc.createdAt = now;
      companyDoc.isSp500 = false;
      companyDoc.marketCapTier = null;
      companyDoc.latest = null;
    }
    await companyRef.set(companyDoc, { merge: true });

    const batchWrites = [
      ...income.map((stmt) => collections.incomeStatements(symbol).doc(stmt.periodKey).set(stmt, { merge: true })),
      ...balance.map((stmt) => collections.balanceSheets(symbol).doc(stmt.periodKey).set(stmt, { merge: true })),
      ...cashFlow.map((stmt) => collections.cashFlowStatements(symbol).doc(stmt.periodKey).set(stmt, { merge: true })),
    ];
    await Promise.all(batchWrites);

    await computeMetricsForCompany(symbol);

    return { ok: true };
  } catch (err) {
    log.error(`ingestFundamentalsForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ingestFundamentalsForUniverse(tickers: string[]): Promise<{
  succeeded: string[];
  failed: Array<{ ticker: string; error: string }>;
}> {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  // SEC EDGAR asks for a conservative request rate; chunk with a small delay
  // instead of firing hundreds of concurrent requests.
  const CHUNK = 5;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((t) => ingestFundamentalsForTicker(t).then((r) => ({ t, r }))));
    for (const { t, r } of results) {
      if (r.ok) succeeded.push(t);
      else failed.push({ ticker: t, error: r.error ?? "unknown error" });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { succeeded, failed };
}

export async function logRefresh(
  dataType: "prices" | "quarterly_statements" | "annual_statements" | "sp500_membership" | "rankings" | "universe_screening",
  provider: string,
  result: { succeeded: string[]; failed: Array<{ ticker: string; error: string }> },
  startedAt: string,
): Promise<void> {
  await collections.dataRefreshLogs().add({
    provider,
    dataType,
    status: result.failed.length === 0 ? "success" : result.succeeded.length === 0 ? "failure" : "partial_failure",
    tickersRequested: result.succeeded.length + result.failed.length,
    tickersSucceeded: result.succeeded.length,
    tickersFailed: result.failed.length,
    errors: result.failed.map((f) => `${f.ticker}: ${f.error}`).slice(0, 50),
    startedAt,
    finishedAt: new Date().toISOString(),
    createdAt: FieldValue.serverTimestamp(),
  });
}
