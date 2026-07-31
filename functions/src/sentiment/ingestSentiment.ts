import type { SentimentHeadline, SentimentSourceBreakdown, SentimentSourceId } from "@proverbs/shared";
import { aggregateSentiment, scoreToDisplayScale } from "@proverbs/shared";
import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { scoreText } from "./scoreText.js";
import { ACTIVE_SOURCES } from "./sources/index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * headline.score is already raw [-1, 1] (straight from scoreText — see its
 * type comment), NOT on the 0-100 display scale, so it's averaged directly
 * here with no unscaling — scoreToDisplayScale is applied exactly once, to
 * the final averaged result, to produce the SentimentSourceBreakdown.score
 * that aggregateSentiment expects to already be display-scale. (Caught via
 * production data: MSFT showed score=0.55 labeled "negative" — internally
 * inconsistent, traced to this function incorrectly treating an
 * already-raw headline score as if it needed unscaling, i.e. applying
 * /50-1 to a number that was never *50+50 in the first place.)
 */
export function summarizeSource(headlines: SentimentHeadline[]): SentimentSourceBreakdown {
  const avgRaw = headlines.reduce((sum, h) => sum + h.score, 0) / headlines.length;
  return {
    score: scoreToDisplayScale(avgRaw),
    articleCount: headlines.length,
    positiveCount: headlines.filter((h) => h.score > 0.15).length,
    negativeCount: headlines.filter((h) => h.score < -0.15).length,
  };
}

/**
 * Fetches + scores headlines for one ticker from `sourcesToFetch` (a subset,
 * not necessarily all of ACTIVE_SOURCES — see the GDELT rotation comment in
 * ingestSentimentForUniverse below), merges with whatever `bySource` data
 * already exists from sources NOT re-fetched this run (so a ticker skipped
 * for GDELT this cycle doesn't lose last cycle's GDELT data), and persists
 * both the full headline detail (companies/{ticker}/sentiment/latest) and
 * the compact per-source + combined summary denormalized onto
 * companies/{ticker}.latest.sentiment.
 */
export async function ingestSentimentForTicker(
  ticker: string,
  sourcesToFetch: SentimentSourceId[] = Object.keys(ACTIVE_SOURCES) as SentimentSourceId[],
): Promise<{ ok: boolean; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const fetched = await Promise.all(
      sourcesToFetch.map(async (id) => {
        const source = ACTIVE_SOURCES[id];
        if (!source) return null;
        // Defense in depth on top of each source's own error handling: one source throwing
        // (network failure, unexpected response shape) must never sink this Promise.all and
        // discard every *other* source's already-successful fetch for this ticker.
        const raw = await source.fetchHeadlines(symbol, null).catch((err) => {
          log.warn(`ingestSentimentForTicker: source "${id}" threw for ${symbol}`, err);
          return null;
        });
        if (!raw) return null;
        const headlines: SentimentHeadline[] = raw.map((h) => ({ ...h, source: id, score: scoreText(h.title).score }));
        return { id, headlines };
      }),
    );

    const existingSnap = await collections.sentiment(symbol).doc("latest").get();
    const existingHeadlines = (existingSnap.data()?.headlines as SentimentHeadline[] | undefined) ?? [];
    const untouchedSourceIds = new Set(Object.keys(ACTIVE_SOURCES)) as Set<SentimentSourceId>;
    for (const id of sourcesToFetch) untouchedSourceIds.delete(id);

    const carriedOverHeadlines = existingHeadlines.filter((h) => untouchedSourceIds.has(h.source));
    const freshHeadlines = fetched.filter((f): f is NonNullable<typeof f> => f != null).flatMap((f) => f.headlines);
    const allHeadlines = [...carriedOverHeadlines, ...freshHeadlines].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

    const now = new Date().toISOString();

    if (allHeadlines.length === 0) {
      await collections.company(symbol).set({ latest: { sentiment: null } }, { merge: true });
      return { ok: true };
    }

    const bySource: Partial<Record<SentimentSourceId, SentimentSourceBreakdown>> = {};
    for (const id of new Set(allHeadlines.map((h) => h.source))) {
      bySource[id] = summarizeSource(allHeadlines.filter((h) => h.source === id));
    }

    const overall = aggregateSentiment(bySource, Object.keys(bySource) as SentimentSourceId[]);
    if (!overall) return { ok: true }; // shouldn't happen given allHeadlines.length > 0, but stay defensive

    await Promise.all([
      collections.sentiment(symbol).doc("latest").set({ asOf: now, headlines: allHeadlines }),
      collections.company(symbol).set({ latest: { sentiment: { asOf: now, ...overall, bySource } } }, { merge: true }),
    ]);

    return { ok: true };
  } catch (err) {
    log.error(`ingestSentimentForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Yahoo and Google News tolerate the same chunked-parallel pacing as the
 * rest of this app's ingestion. GDELT does not — it asks for one request per
 * 5 seconds *globally*, which is incompatible with covering hundreds of
 * tickers inside a single ~540s function invocation (300 tickers x 5s =
 * 1500s) or with any concurrent fetching at all. So this runs as two
 * distinct passes rather than one merged loop: Yahoo+Google News first,
 * chunked and parallel like everything else; then a small rotating slice of
 * the batch (GDELT_SLICE tickers) gets a true sequential GDELT pass on top,
 * merging into what the first pass already wrote (ingestSentimentForTicker's
 * "carry forward untouched sources" logic preserves the rest). Since
 * sentimentRefresh cycles the full universe continuously, every ticker
 * eventually gets GDELT coverage too — just refreshed less often than the
 * other two sources.
 */
const GDELT_SLICE = 25;
const GDELT_GAP_MS = 5500;
const CHUNK = 5;

export async function ingestSentimentForUniverse(tickers: string[]): Promise<{
  succeeded: string[];
  failed: Array<{ ticker: string; error: string }>;
}> {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((t) => ingestSentimentForTicker(t, ["yahoo", "google_news"]).then((r) => ({ t, r }))));
    for (const { t, r } of results) {
      if (r.ok) succeeded.push(t);
      else failed.push({ ticker: t, error: r.error ?? "unknown error" });
    }
    await sleep(300);
  }

  for (const ticker of tickers.slice(0, GDELT_SLICE)) {
    await sleep(GDELT_GAP_MS);
    const r = await ingestSentimentForTicker(ticker, ["gdelt"]);
    if (!r.ok) log.warn(`ingestSentimentForUniverse: GDELT pass failed for ${ticker}: ${r.error}`);
  }

  return { succeeded, failed };
}
