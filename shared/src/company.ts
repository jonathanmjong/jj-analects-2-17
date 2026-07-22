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
  overallScore: number | null;
  overallRank: number | null;
}

/** Firestore subcollection: companies/{ticker}/marketData/{YYYY-MM-DD} */
export interface MarketDataPoint {
  date: string;
  sharePrice: number;
  marketCap: number;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
}
