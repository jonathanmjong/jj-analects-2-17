export type SentimentLabel = "positive" | "neutral" | "negative";

export type SentimentSourceId =
  | "yahoo"
  | "google_news"
  | "gdelt"
  | "reddit"
  | "stocktwits"
  | "finnhub"
  | "alpha_vantage"
  | "x";

export interface SentimentSourceInfo {
  id: SentimentSourceId;
  label: string;
  /** True = live, keyless, fetched by the ingestion job today. False = the checkbox exists so the option is visible, but nothing is fetched from it yet. */
  available: boolean;
  /** Only meaningful when available is false — shown as a tooltip/caption next to the disabled checkbox. */
  unavailableReason?: string;
}

/**
 * Every source considered, including the ones that don't work — each entry
 * here was actually tried (not just assumed) before being marked available:
 * true. StockTwits' public API is behind a Cloudflare bot challenge (not a
 * simple rate limit) that a server-side fetch can't pass; Reddit's read API
 * has required OAuth app credentials since their 2023 policy change, even
 * for anonymous reads; X's free API tier doesn't support this kind of bulk
 * access at all. Finnhub/Alpha Vantage have real sentiment endpoints but
 * need a free API key nobody has provided yet. Keeping the non-working ones
 * in this list (disabled, not hidden) so the option is visible and the
 * reason is documented right where a future implementer would look, instead
 * of being silently absent.
 */
export const SENTIMENT_SOURCES: SentimentSourceInfo[] = [
  { id: "yahoo", label: "Yahoo Finance News", available: true },
  { id: "google_news", label: "Google News", available: true },
  { id: "gdelt", label: "GDELT News Index", available: true },
  {
    id: "reddit",
    label: "Reddit",
    available: false,
    unavailableReason: "Requires a registered Reddit API app (client ID/secret) for OAuth — not configured.",
  },
  {
    id: "stocktwits",
    label: "StockTwits",
    available: false,
    unavailableReason: "Blocked by Cloudflare's bot challenge on server-side requests — needs a paid proxy/vendor to access.",
  },
  {
    id: "finnhub",
    label: "Finnhub",
    available: false,
    unavailableReason: "Requires a free Finnhub API key (FINNHUB_API_KEY) — not configured.",
  },
  {
    id: "alpha_vantage",
    label: "Alpha Vantage",
    available: false,
    unavailableReason: "Requires a free Alpha Vantage API key (ALPHA_VANTAGE_API_KEY) — not configured.",
  },
  {
    id: "x",
    label: "X (Twitter)",
    available: false,
    unavailableReason: "X's free API tier doesn't support bulk ticker-mention access.",
  },
];

/** One recent headline and its individually-scored sentiment. */
export interface SentimentHeadline {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  source: SentimentSourceId;
  /** -1 (most negative) to 1 (most positive) — see functions/src/sentiment/scoreText.ts. */
  score: number;
}

/**
 * Firestore doc: companies/{ticker}/sentiment/latest — full recent-headline
 * detail, kept separate from the company doc so it doesn't bloat the
 * denormalized `latest` snapshot every list view reads.
 */
export interface SentimentDetail {
  asOf: string;
  headlines: SentimentHeadline[];
}

export interface SentimentSourceBreakdown {
  score: number;
  articleCount: number;
  positiveCount: number;
  negativeCount: number;
}

/** Maps a [-1, 1] lexicon score to the app's 0-100 display scale (50 = neutral), matching overallScore's convention. */
export function scoreToDisplayScale(score: number): number {
  return (score + 1) * 50;
}

export function labelForScore(score: number): SentimentLabel {
  if (score > 0.15) return "positive";
  if (score < -0.15) return "negative";
  return "neutral";
}

/**
 * Compact summary denormalized onto companies/{ticker}.latest.sentiment —
 * same "current snapshot" pattern as momentum/headline metrics, so the
 * Rankings/Sentiment tables can sort/filter without a subcollection read per
 * row. `bySource` lets the client recompute score/label from just the
 * sources a user has selected via the source-picker checkboxes, without a
 * refetch — see web/src/lib/sentimentAggregate.ts.
 */
export interface SentimentSnapshot {
  asOf: string;
  /** 0-100, same scale/convention as overallScore (50 = neutral) — see scoreToDisplayScale above. All-sources-combined; the default view before any source filtering. */
  score: number;
  label: SentimentLabel;
  articleCount: number;
  positiveCount: number;
  negativeCount: number;
  bySource: Partial<Record<SentimentSourceId, SentimentSourceBreakdown>>;
}

/**
 * Recomputes a score/label/counts from just the given subset of sources —
 * article-count-weighted (a source with 10 headlines counts more than one
 * with 1), not a plain average of per-source scores. Used both server-side
 * (building the initial "all sources" snapshot) and client-side (the
 * Sentiment page's source checkboxes recompute this instantly from data
 * already in hand, no refetch). Returns null when none of the requested
 * sources have any data — "unscored," not "neutral."
 */
export function aggregateSentiment(
  bySource: Partial<Record<SentimentSourceId, SentimentSourceBreakdown>>,
  selectedSources: SentimentSourceId[],
): { score: number; label: SentimentLabel; articleCount: number; positiveCount: number; negativeCount: number } | null {
  const entries = selectedSources.map((id) => bySource[id]).filter((b): b is SentimentSourceBreakdown => b != null);
  const articleCount = entries.reduce((sum, b) => sum + b.articleCount, 0);
  if (articleCount === 0) return null;

  // Undo the display-scale mapping to weight in raw [-1, 1] terms, then reapply it once at the end.
  const weightedRaw = entries.reduce((sum, b) => sum + (b.score / 50 - 1) * b.articleCount, 0) / articleCount;

  return {
    score: scoreToDisplayScale(weightedRaw),
    label: labelForScore(weightedRaw),
    articleCount,
    positiveCount: entries.reduce((sum, b) => sum + b.positiveCount, 0),
    negativeCount: entries.reduce((sum, b) => sum + b.negativeCount, 0),
  };
}
