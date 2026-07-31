import type { MomentumSnapshot } from "./momentum.js";
import type { SentimentSnapshot } from "./sentiment.js";

export type Sector =
  | "Technology"
  | "Healthcare"
  | "Financials"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Utilities"
  | "Industrials"
  | "Real Estate"
  | "Communication Services"
  | "Materials";

export const SECTORS: Sector[] = [
  "Technology",
  "Healthcare",
  "Financials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Utilities",
  "Industrials",
  "Real Estate",
  "Communication Services",
  "Materials",
];

/** Firestore doc id === ticker (uppercased). Collection: companies */
export interface Company {
  ticker: string;
  companyName: string;
  cik: string | null;
  sector: Sector | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  country: string | null;
  isSp500: boolean;
  marketCapTier: "mid" | "large" | null;
  /** Denormalized for fast list/table reads without a subcollection join. */
  latest: LatestSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface LatestSnapshot {
  asOf: string;
  sharePrice: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
  /**
   * "live" when sharePrice/marketCap came from a real-time quote; "sec_public_float" when the
   * live quote source was unavailable/implausible and ingestion fell back to SEC EDGAR's
   * EntityPublicFloat (approximate market value as of the most recent 10-K/10-Q cover-page date,
   * not a live price) — see ingestPrices.ts's resolveQuote. Can lag `asOf` by months in that case,
   * so the UI must not present it as a current market price without distinguishing the two.
   */
  priceSource?: "live" | "sec_public_float";
  overallScore: number | null;
  overallRank: number | null;
  /** Raw P/E, EV/EBITDA, dividend yield, ROIC, FCF yield — see HeadlineMetrics in ranking.ts. Populated by the ranking engine, not price ingestion. */
  headlineMetrics?: HeadlineMetrics;
  /** Populated by ingestPriceHistory.ts, independently of the price/statement refresh cycle. */
  momentum?: MomentumSnapshot;
  /** Populated by ingestSentiment.ts — lexicon-scored recent news headlines, refreshed independently. */
  sentiment?: SentimentSnapshot;
}

export interface HeadlineMetrics {
  peTtm: number | null;
  evEbitda: number | null;
  dividendYield: number | null;
  roic: number | null;
  fcfYield: number | null;
  revenueGrowth1y: number | null;
}

/** Firestore subcollection: companies/{ticker}/marketData/{YYYY-MM-DD} */
export interface MarketDataPoint {
  date: string;
  sharePrice: number;
  marketCap: number;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
}
