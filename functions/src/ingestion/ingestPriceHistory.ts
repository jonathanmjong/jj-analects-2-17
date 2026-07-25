import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { YahooFinanceProvider } from "../providers/YahooFinanceProvider.js";
import { computeMomentumFromSeries } from "./computeMomentum.js";

const yahoo = new YahooFinanceProvider();

/**
 * Fetches a ~2-year daily price series from Yahoo, derives momentum figures
 * from it, and persists both — the compact series (for potential future
 * reuse) and the derived MomentumSnapshot denormalized onto
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
 * Sequential with a real gap between requests, same reasoning as
 * ingestPricesForUniverse: Yahoo's chart endpoint silently drops most
 * responses under concurrency. A history fetch returns far more data per
 * call than a quote, so this uses a slightly longer gap.
 */
export async function ingestPriceHistoryForUniverse(tickers: string[]) {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    let result = await ingestPriceHistoryForTicker(ticker);
    if (!result.ok) {
      await sleep(800);
      result = await ingestPriceHistoryForTicker(ticker);
    }
    if (result.ok) succeeded.push(ticker);
    else failed.push({ ticker, error: result.error ?? "unknown error" });
    await sleep(450);
  }
  return { succeeded, failed };
}
