import type { RawHeadline, SentimentSource } from "./types.js";

/** Parses GDELT's compact "20260522T121500Z" timestamp into a real Date. */
function parseGdeltDate(seendate: string): Date | null {
  const match = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

/**
 * GDELT Project's free, keyless DOC API — a global news-monitoring index
 * updated every 15 minutes. Confirmed working, but strict about pacing (its
 * own error response asks for "one request every 5 seconds"; ingestSentiment.ts
 * paces well under that across the whole batch, not just per-ticker). Scoped
 * to English-language sources (`sourcelang:eng`) since the scorer's lexicon
 * is English-only — GDELT indexes ~65 languages and would otherwise return
 * plenty of headlines this app can't meaningfully score.
 */
export class GdeltSource implements SentimentSource {
  async fetchHeadlines(ticker: string, companyName: string | null): Promise<RawHeadline[] | null> {
    try {
      const query = encodeURIComponent(`"${ticker}" stock ${companyName ?? ""} sourcelang:eng`.trim());
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=10&format=json`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;

      const text = await res.text();
      let json: { articles?: Array<{ url?: string; title?: string; seendate?: string; domain?: string }> };
      try {
        json = JSON.parse(text);
      } catch {
        // GDELT returns a plain-text rate-limit notice (not JSON) when a caller exceeds its pacing
        // rules — indistinguishable from a real empty result without trying to parse it.
        return null;
      }

      const articles = json.articles;
      if (!articles) return null;

      const headlines: RawHeadline[] = [];
      for (const a of articles) {
        if (!a.title || !a.url || !a.seendate) continue;
        const publishedAt = parseGdeltDate(a.seendate);
        if (!publishedAt) continue;
        headlines.push({ title: a.title, publisher: a.domain ?? "GDELT", url: a.url, publishedAt: publishedAt.toISOString() });
      }
      return headlines.length > 0 ? headlines : null;
    } catch {
      // A network-level failure (DNS, connect timeout, etc. — not just a non-2xx response) must
      // still resolve to "no data from this source," not throw: uncaught, it would reject the
      // Promise.all in ingestSentimentForTicker and sink that ticker's *other*, successfully
      // fetched sources too. Confirmed hitting this in practice (ConnectTimeoutError) during dev.
      return null;
    }
  }
}
