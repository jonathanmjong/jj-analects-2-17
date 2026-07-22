import type { MetricCategory, NormalizationMethod } from "./metrics.js";

export interface RankingWeightsConfig {
  categoryWeights: Record<MetricCategory, number>;
  normalizationMethod: NormalizationMethod;
  winsorizeLowerPct: number;
  winsorizeUpperPct: number;
  /** How many of the trailing years (1-5) to include in each metric's multi-year score. */
  yearsIncluded: 1 | 2 | 3 | 4 | 5;
}

export interface CategoryScore {
  category: MetricCategory;
  score: number | null;
  weight: number;
  metricsIncluded: number;
  metricsMissing: number;
}

/** Firestore doc: rankings/latest/companies/{ticker} and historicalRankings/{ticker}/snapshots/{date} */
export interface RankingResult {
  ticker: string;
  computedAt: string;
  overallScore: number | null;
  overallRank: number | null;
  peerCount: number;
  categoryScores: CategoryScore[];
  weightsUsed: RankingWeightsConfig;
}

export const DEFAULT_RANKING_CONFIG: RankingWeightsConfig = {
  categoryWeights: {
    valuation: 0.3,
    profitability: 0.2,
    growth: 0.2,
    financialStrength: 0.15,
    capitalAllocation: 0.1,
    earningsQuality: 0.05,
    cashGeneration: 0,
    efficiency: 0,
    moat: 0,
  },
  normalizationMethod: "percentile",
  winsorizeLowerPct: 0.01,
  winsorizeUpperPct: 0.99,
  yearsIncluded: 5,
};

/** Firestore collection: dataRefreshLogs/{autoId} */
export interface DataRefreshLog {
  id: string;
  provider: string;
  dataType: "prices" | "quarterly_statements" | "annual_statements" | "sp500_membership" | "rankings";
  status: "running" | "success" | "partial_failure" | "failure";
  tickersRequested: number;
  tickersSucceeded: number;
  tickersFailed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}
