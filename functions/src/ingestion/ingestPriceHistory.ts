import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { YahooFinanceProvider } from "../providers/YahooFinanceProvider.js";
import { computeMomentumFromSeries } from "./computeMomentum.js";

const yahoo = new YahooFinanceProvider();

/**
 * Fetches a ~1-year daily price series from Yahoo (see getPriceHistory's own
 * doc comment for why not 2 years — range=2y reliably fails from Cloud
 * Functions' IPs), derives momentum figures from it, and persists both — the
 * compact series (for potential future reuse, e.g. the Company page's price
 * chart) and the derived MomentumSnapshot denormalized onto
 * companies/{ticker}.latest, the same place marketCap/enterpriseValue live,
 * so computeMetricsForCompany can treat momentum like any other
 * current-snapshot input. SEC EDGAR has no price history at all, so unlike
 * ingestPrices.ts there's no fallback source — momentum simply stays
 * unpopulated for a ticker until a live Yahoo fetch succeeds for it.
 */
export async function ingestPriceHistoryForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const points = await yahoo.getPriceHistory(symbol);
    if (!points) return { ok: false, error: "no price history available from Yahoo" };

    const momentum = computeMomentumFromSeries(points);
    if (!momentum) return { ok: false, error: "price history returned but too sparse to compute momentum" };

    const now = new Date().toISOString();
    await Promise.all([
      collections.priceHistory(symbol).doc("daily").set({ points, updatedAt: now }),
      collections.company(symbol).set({ latest: { momentum } }, { merge: true }),
    ]);

    return { ok: true };
  } catch (err) {
    log.error(`ingestPriceHistoryForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sequential with a long gap between requests. Confirmed in production
 * (2026-07-26) that Yahoo's chart endpoint applies a much stricter
 * rate limit to this history query (range=1y) than to the plain daily-quote
 * query ingestPricesForUniverse makes — that job succeeds ~96-100% of the
 * time at a 350ms gap, while this one got HTTP 429 on nearly every request
 * at a 450ms gap. No immediate same-ticker retry: retrying into an active
 * 429 window just spends another request without helping, so a failed
 * ticker is simply left for the next invocation (whose cursor will
 * eventually cycle back to it) rather than compounding the throttling here.
 *
 * As of 2026-08-04, this endpoint had degraded to a ~100% failure rate for
 * 5+ days straight even at a 2s gap — confirmed via direct testing that a
 * completely different network also gets HTTP 429 from the same endpoint
 * after just a handful of requests, so this isn't purely a Cloud Functions
 * IP problem, and reducing volume here isn't guaranteed to fix it (Cloud
 * Functions' egress IP pool is shared with other tenants' traffic). Gap
 * widened to 4s and priceHistoryRefresh's batch/schedule both cut (see that
 * file) as a best-effort, no-cost attempt to lighten this app's own
 * contribution to whatever load tripped the block, in case it's usage-based
 * and can decay over time.
 */
export async function ingestPriceHistoryForUniverse(tickers: string[]) {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    const result = await ingestPriceHistoryForTicker(ticker);
    if (result.ok) succeeded.push(ticker);
    else failed.push({ ticker, error: result.error ?? "unknown error" });
    await sleep(4000);
  }
  return { succeeded, failed };
}
