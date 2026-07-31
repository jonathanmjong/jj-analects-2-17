export type SentimentLabel = "positive" | "neutral" | "negative";

/** One recent headline and its individually-scored sentiment. */
export interface SentimentHeadline {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
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

/**
 * Compact summary denormalized onto companies/{ticker}.latest.sentiment —
 * same "current snapshot" pattern as momentum/headline metrics, so the
 * Rankings table can sort/filter by sentiment without a subcollection read
 * per row.
 */
export interface SentimentSnapshot {
  asOf: string;
  /** 0-100, same scale/convention as overallScore (50 = neutral) — see scoreToDisplayScale in scoreText.ts. */
  score: number;
  label: SentimentLabel;
  articleCount: number;
  positiveCount: number;
  negativeCount: number;
}
