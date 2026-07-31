import type { RawHeadline, SentimentSource } from "./types.js";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeEntities(match[1].trim()) : null;
}

/**
 * Google News' search RSS feed — free, keyless, confirmed working. No
 * official JSON API; parsed with plain regex rather than pulling in an XML
 * dependency, since the feed's structure is simple and consistent (no CDATA,
 * plain entity-encoded text). Titles arrive as "Headline - Publisher" (Google
 * News' own convention) — split on the last " - " to separate them. `<link>`
 * is a Google News redirect URL, not the original article link — that's
 * expected, not a bug; it still resolves to the real article.
 */
export class GoogleNewsSource implements SentimentSource {
  async fetchHeadlines(ticker: string, companyName: string | null): Promise<RawHeadline[] | null> {
    const query = encodeURIComponent(`"${ticker}" stock ${companyName ?? ""}`.trim());
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/xml" } });
    if (!res.ok) return null;

    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    if (items.length === 0) return null;

    const headlines: RawHeadline[] = [];
    for (const item of items) {
      const rawTitle = extractTag(item, "title");
      const link = extractTag(item, "link");
      const pubDate = extractTag(item, "pubDate");
      if (!rawTitle || !link || !pubDate) continue;

      const lastDash = rawTitle.lastIndexOf(" - ");
      const title = lastDash > 0 ? rawTitle.slice(0, lastDash) : rawTitle;
      const publisher = lastDash > 0 ? rawTitle.slice(lastDash + 3) : "Google News";

      const publishedAt = new Date(pubDate);
      if (Number.isNaN(publishedAt.getTime())) continue;

      headlines.push({ title, publisher, url: link, publishedAt: publishedAt.toISOString() });
    }
    return headlines.length > 0 ? headlines : null;
  }
}
