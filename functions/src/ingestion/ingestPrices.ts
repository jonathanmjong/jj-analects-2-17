import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { getProvider, PRICE_PROVIDER } from "../providers/index.js";

export async function ingestPriceForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const quote = await getProvider(PRICE_PROVIDER).getQuote(symbol);
    if (!quote) return { ok: false, error: "no quote returned" };

    await collections.marketData(symbol).doc(quote.date).set(quote, { merge: true });

    const companyRef = collections.company(symbol);
    const existing = await companyRef.get();
    const prevScore = existing.data()?.latest?.overallScore ?? null;
    const prevRank = existing.data()?.latest?.overallRank ?? null;
    await companyRef.set(
      {
        latest: {
          asOf: quote.date,
          sharePrice: quote.sharePrice,
          marketCap: quote.marketCap,
          enterpriseValue: quote.enterpriseValue,
          sharesOutstanding: quote.sharesOutstanding,
          overallScore: prevScore,
          overallRank: prevRank,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return { ok: true };
  } catch (err) {
    log.error(`ingestPriceForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ingestPricesForUniverse(tickers: string[]) {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];
  const CHUNK = 10;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((t) => ingestPriceForTicker(t).then((r) => ({ t, r }))));
    for (const { t, r } of results) {
      if (r.ok) succeeded.push(t);
      else failed.push({ ticker: t, error: r.error ?? "unknown error" });
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { succeeded, failed };
}
