import type { MetricCategory, NormalizationMethod } from "./metrics.js";
import type { HeadlineMetrics } from "./company.js";

export interface RankingWeightsConfig {
  categoryWeights: Record<MetricCategory, number>;
  normalizationMethod: NormalizationMethod;
  winsorizeLowerPct: number;
  winsorizeUpperPct: number;
  /** How many of the trailing years (1-5) to include in each metric's multi-year score. */
  yearsIncluded: 1 | 2 | 3 | 4 | 5;
  /**
   * Optional per-metric weight overrides (metric key -> relative weight,
   * any non-negative number — they're renormalized against each other, not
   * required to sum to 1). Metrics in a category with no entry here default
   * to weight 1 (equal weighting), matching the original behavior. A weight
   * of 0 excludes that metric from its category score entirely.
   */
  metricWeights?: Record<string, number>;
}

export interface CategoryScore {
  category: MetricCategory;
  score: number | null;
  weight: number;
  metricsIncluded: number;
  metricsMissing: number;
  /**
   * Metrics skipped because they're structurally inapplicable to this company's sector (see
   * shared/src/sectorApplicability.ts) — deliberately not folded into metricsMissing, since a
   * bank isn't "missing" ROIC. Optional because ranking docs persisted before this field
   * existed are read back as CategoryScore.
   */
  metricsNotApplicable?: number;
}

export type CoverageTier = "full" | "partial" | "thin";

/**
 * How much of the applicable metric set actually fed a company's score. Without it, a company
 * scored on 2 metrics and one scored on 60 emit an equally confident 0-100 with nothing marking
 * the difference. "applicable" already excludes metrics that are meaningless for the company's
 * sector, so a bank is measured against the metrics that can describe a bank, not against the
 * whole registry.
 */
export interface ScoreCoverage {
  metricsIncluded: number;
  /** metricsIncluded + metricsMissing, i.e. metrics that could have applied to this company. */
  metricsApplicable: number;
  /** metricsIncluded / metricsApplicable; 0 when nothing was applicable. */
  ratio: number;
  tier: CoverageTier;
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
  headlineMetrics: HeadlineMetrics;
  /** Optional: ranking docs persisted before coverage existed are read back as RankingResult. */
  coverage?: ScoreCoverage;
}

export const DEFAULT_RANKING_CONFIG: RankingWeightsConfig = {
  categoryWeights: {
    valuation: 0.2,
    profitability: 0.15,
    growth: 0.15,
    cashGeneration: 0.1,
    financialStrength: 0.1,
    capitalAllocation: 0.1,
    efficiency: 0.1,
    earningsQuality: 0.05,
    moat: 0.05,
    momentum: 0,
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
  dataType:
    | "prices"
    | "price_history"
    | "quarterly_statements"
    | "annual_statements"
    | "sp500_membership"
    | "rankings"
    | "universe_screening"
    | "sentiment";
  status: "running" | "success" | "partial_failure" | "failure";
  tickersRequested: number;
  tickersSucceeded: number;
  tickersFailed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}
