import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { YahooFinanceProvider } from "../providers/YahooFinanceProvider.js";
import { labelForScore, scoreText, scoreToDisplayScale } from "./scoreText.js";

const yahoo = new YahooFinanceProvider();

/**
 * Fetches recent headlines for a ticker, scores each one, and persists both
 * the full detail (companies/{ticker}/sentiment/latest, for the Company
 * page's headline list) and a compact summary denormalized onto
 * companies/{ticker}.latest.sentiment (for the Sentiment ranking table,
 * which reads across the whole universe and can't afford a subcollection
 * read per row) — the same split as price history vs. the momentum
 * snapshot.
 */
export async function ingestSentimentForTicker(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const news = await yahoo.getNews(symbol);
    if (!news) return { ok: false, error: "no news available from Yahoo" };

    const now = new Date().toISOString();
    const headlines = news
      .map((n) => ({ ...n, score: scoreText(n.title).score }))
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

    if (headlines.length === 0) {
      // A ticker with genuinely zero recent coverage isn't an error — just nothing to score.
      await collections.company(symbol).set({ latest: { sentiment: null } }, { merge: true });
      return { ok: true };
    }

    const scores = headlines.map((h) => h.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const positiveCount = scores.filter((s) => s > 0.15).length;
    const negativeCount = scores.filter((s) => s < -0.15).length;

    await Promise.all([
      collections.sentiment(symbol).doc("latest").set({ asOf: now, headlines }),
      collections.company(symbol).set(
        {
          latest: {
            sentiment: {
              asOf: now,
              score: scoreToDisplayScale(avgScore),
              label: labelForScore(avgScore),
              articleCount: headlines.length,
              positiveCount,
              negativeCount,
            },
          },
        },
        { merge: true },
      ),
    ]);

    return { ok: true };
  } catch (err) {
    log.error(`ingestSentimentForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same chunked, rate-limited pattern as ingestFundamentalsForUniverse — Yahoo's search endpoint shares the same host as the other unofficial endpoints, so the same conservative pacing applies. */
export async function ingestSentimentForUniverse(tickers: string[]): Promise<{
  succeeded: string[];
  failed: Array<{ ticker: string; error: string }>;
}> {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  const CHUNK = 5;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((t) => ingestSentimentForTicker(t).then((r) => ({ t, r }))));
    for (const { t, r } of results) {
      if (r.ok) succeeded.push(t);
      else failed.push({ ticker: t, error: r.error ?? "unknown error" });
    }
    await sleep(300);
  }
  return { succeeded, failed };
}
