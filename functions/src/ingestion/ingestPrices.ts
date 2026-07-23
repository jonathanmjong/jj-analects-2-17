import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { getProvider, PRICE_PROVIDER } from "../providers/index.js";
import { computeMetricsForCompany } from "../metrics/computeMetrics.js";

export async function ingestPriceForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const quote = await getProvider(PRICE_PROVIDER).getQuote(symbol);
    if (!quote) return { ok: false, error: "no quote returned" };

    // Yahoo's reliable quote endpoint doesn't return market cap / shares
    // outstanding directly (see YahooFinanceProvider.getQuote) — derive them
    // from the most recently ingested SEC EDGAR statement instead.
    const [latestIncomeSnap, latestBalanceSnap] = await Promise.all([
      collections.incomeStatements(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
      collections.balanceSheets(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
    ]);
    const sharesOutstanding = (latestIncomeSnap.docs[0]?.data()?.sharesOutstandingDiluted as number | null) ?? null;
    const totalDebt = (latestBalanceSnap.docs[0]?.data()?.totalDebt as number | null) ?? 0;
    const cash = (latestBalanceSnap.docs[0]?.data()?.cashAndEquivalents as number | null) ?? 0;
    const marketCap = sharesOutstanding !== null ? quote.sharePrice * sharesOutstanding : 0;
    const enterpriseValue = marketCap > 0 ? marketCap + totalDebt - cash : null;

    const enrichedQuote = { ...quote, marketCap, enterpriseValue, sharesOutstanding };
    await collections.marketData(symbol).doc(quote.date).set(enrichedQuote, { merge: true });

    const companyRef = collections.company(symbol);
    const existing = await companyRef.get();
    const prevScore = existing.data()?.latest?.overallScore ?? null;
    const prevRank = existing.data()?.latest?.overallRank ?? null;
    await companyRef.set(
      {
        latest: {
          asOf: quote.date,
          sharePrice: quote.sharePrice,
          marketCap,
          enterpriseValue,
          sharesOutstanding,
          overallScore: prevScore,
          overallRank: prevRank,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    // Valuation metrics depend on today's market cap/EV combined with the
    // last-ingested statements — recompute now so a price refresh alone
    // (without waiting for the next statement refresh) keeps them current.
    if (marketCap > 0) {
      await computeMetricsForCompany(symbol);
    }

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
