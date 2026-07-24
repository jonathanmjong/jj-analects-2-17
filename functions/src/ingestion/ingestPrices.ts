import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { getProvider, PRICE_PROVIDER } from "../providers/index.js";
import { SecEdgarProvider } from "../providers/SecEdgarProvider.js";
import { computeMetricsForCompany } from "../metrics/computeMetrics.js";

const secEdgarFallback = new SecEdgarProvider();

/**
 * $10T ceiling, well above the largest real companies (~$3-4T as of any
 * recent date) but far below the garbage values self-reported XBRL data
 * occasionally contains. Observed in production: two real SEC filers
 * (Cabot Corp, Champion Homes) had EntityPublicFloat values off by exactly
 * 10^6x and 10^3x respectively across multiple years' 10-Ks — a filer-side
 * XBRL scale/decimals tagging error, not something we can correct, only
 * detect and reject rather than let corrupt the ranked universe.
 */
export const MAX_PLAUSIBLE_MARKET_CAP = 10_000_000_000_000;

/**
 * A $10T absolute ceiling alone doesn't catch every filer XBRL error — e.g.
 * Champion Homes' EntityPublicFloat was tagged off by exactly 10^3x, landing
 * at $4.1T, which is "plausible" in the abstract (megacap territory) but
 * absurd for that specific company. Where revenue is available, also reject
 * anything above a generous price-to-sales ratio; 100x comfortably clears
 * even richly-valued high-growth companies while catching magnitude errors.
 */
const MAX_PLAUSIBLE_PRICE_TO_SALES = 100;

export function isPlausibleMarketCap(marketCap: number, revenue?: number | null): boolean {
  if (!(marketCap > 0 && marketCap <= MAX_PLAUSIBLE_MARKET_CAP)) return false;
  if (revenue !== undefined && revenue !== null && revenue > 0) {
    return marketCap <= revenue * MAX_PLAUSIBLE_PRICE_TO_SALES;
  }
  return true;
}

interface ResolvedQuote {
  date: string;
  sharePrice: number | null;
  marketCap: number;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
  /** "live" when sourced from Yahoo; "sec_public_float" when derived from a 10-K cover-page filing date instead. */
  source: "live" | "sec_public_float";
}

async function resolveQuote(symbol: string): Promise<ResolvedQuote | null> {
  const liveQuote = await getProvider(PRICE_PROVIDER).getQuote(symbol);
  if (liveQuote) {
    const [latestIncomeSnap, latestBalanceSnap] = await Promise.all([
      collections.incomeStatements(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
      collections.balanceSheets(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
    ]);
    const sharesOutstanding = (latestIncomeSnap.docs[0]?.data()?.sharesOutstandingDiluted as number | null) ?? null;
    const revenue = (latestIncomeSnap.docs[0]?.data()?.revenue as number | null) ?? null;
    const totalDebt = (latestBalanceSnap.docs[0]?.data()?.totalDebt as number | null) ?? 0;
    const cash = (latestBalanceSnap.docs[0]?.data()?.cashAndEquivalents as number | null) ?? 0;
    const marketCap = sharesOutstanding !== null ? liveQuote.sharePrice * sharesOutstanding : 0;
    if (isPlausibleMarketCap(marketCap, revenue)) {
      return {
        date: liveQuote.date,
        sharePrice: liveQuote.sharePrice,
        marketCap,
        enterpriseValue: marketCap > 0 ? marketCap + totalDebt - cash : null,
        sharesOutstanding,
        source: "live",
      };
    }
    if (marketCap > MAX_PLAUSIBLE_MARKET_CAP) {
      log.warn(`Implausible market cap from live quote for ${symbol}: $${marketCap} — falling back to SEC EDGAR`);
    }
  }

  // Live price source unavailable (or implausible) — fall back to SEC
  // EDGAR's official EntityPublicFloat (approximate market value as of the
  // most recent 10-K cover-page date). Not live, but real and keyless.
  const approx = await secEdgarFallback.getApproxMarketValue(symbol);
  if (!approx) return null;

  const [latestBalanceSnap, latestIncomeSnap] = await Promise.all([
    collections.balanceSheets(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
    collections.incomeStatements(symbol).orderBy("fiscalYear", "desc").limit(1).get(),
  ]);
  const revenue = (latestIncomeSnap.docs[0]?.data()?.revenue as number | null) ?? null;
  if (!isPlausibleMarketCap(approx.publicFloat, revenue)) {
    log.warn(`Implausible EntityPublicFloat for ${symbol}: $${approx.publicFloat} (likely a filer XBRL tagging error) — skipping`);
    return null;
  }

  const totalDebt = (latestBalanceSnap.docs[0]?.data()?.totalDebt as number | null) ?? 0;
  const cash = (latestBalanceSnap.docs[0]?.data()?.cashAndEquivalents as number | null) ?? 0;
  const marketCap = approx.publicFloat;
  return {
    date: approx.asOfDate,
    sharePrice: approx.sharesOutstanding ? marketCap / approx.sharesOutstanding : null,
    marketCap,
    enterpriseValue: marketCap > 0 ? marketCap + totalDebt - cash : null,
    sharesOutstanding: approx.sharesOutstanding,
    source: "sec_public_float",
  };
}

export async function ingestPriceForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const resolved = await resolveQuote(symbol);
    if (!resolved) return { ok: false, error: "no quote available from any source" };

    await collections.marketData(symbol).doc(resolved.date).set(resolved, { merge: true });

    const companyRef = collections.company(symbol);
    const existing = await companyRef.get();
    const prevScore = existing.data()?.latest?.overallScore ?? null;
    const prevRank = existing.data()?.latest?.overallRank ?? null;
    await companyRef.set(
      {
        latest: {
          asOf: resolved.date,
          sharePrice: resolved.sharePrice,
          marketCap: resolved.marketCap,
          enterpriseValue: resolved.enterpriseValue,
          sharesOutstanding: resolved.sharesOutstanding,
          priceSource: resolved.source,
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
    if (resolved.marketCap > 0) {
      await computeMetricsForCompany(symbol);
    }

    return { ok: true };
  } catch (err) {
    log.error(`ingestPriceForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Yahoo's unofficial chart endpoint tolerates single sequential requests
 * reliably but starts silently failing (returns no meta / empty body rather
 * than an HTTP error, so nothing gets logged) under even modest concurrency
 * — a burst of 10 parallel requests dropped ~96% of quotes in production.
 * One request at a time with a real gap between them, plus one retry on a
 * null quote, trades a slower total run for actually getting the data. When
 * Yahoo is unavailable entirely, resolveQuote() falls back to SEC EDGAR.
 */
export async function ingestPricesForUniverse(tickers: string[]) {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    let result = await ingestPriceForTicker(ticker);
    if (!result.ok) {
      await sleep(800);
      result = await ingestPriceForTicker(ticker);
    }
    if (result.ok) succeeded.push(ticker);
    else failed.push({ ticker, error: result.error ?? "unknown error" });
    await sleep(350);
  }
  return { succeeded, failed };
}
