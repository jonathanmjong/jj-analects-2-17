export type MetricCategory =
  | "valuation"
  | "profitability"
  | "growth"
  | "cashGeneration"
  | "financialStrength"
  | "capitalAllocation"
  | "efficiency"
  | "earningsQuality"
  | "moat";

export const METRIC_CATEGORIES: MetricCategory[] = [
  "valuation",
  "profitability",
  "growth",
  "cashGeneration",
  "financialStrength",
  "capitalAllocation",
  "efficiency",
  "earningsQuality",
  "moat",
];

export type MetricDirection = "asc" | "desc";
export type NormalizationMethod = "percentile" | "zscore";

/**
 * Registry entry describing one metric. Adding a new metric to the platform
 * means: (1) add a calculator function, (2) add one MetricDefinition here.
 * Nothing else in the ranking pipeline needs to change.
 */
export interface MetricDefinition {
  key: string;
  label: string;
  category: MetricCategory;
  /** "desc": higher raw value is better (e.g. ROIC). "asc": lower is better (e.g. EV/EBITDA). */
  direction: MetricDirection;
  unit: "ratio" | "percent" | "multiple" | "currency" | "years";
  description: string;
  enabled: boolean;
}

/** One metric's computed value for a single company + period, pre-ranking. */
export interface RawMetricValue {
  metricKey: string;
  periodKey: string;
  value: number | null;
  /** True when required inputs were missing/zero-division and value is null. */
  isMissing: boolean;
}

/** Firestore subcollection: companies/{ticker}/metricScores/{periodKey}, map keyed by metricKey. */
export interface MetricScore {
  metricKey: string;
  periodKey: string;
  rawValue: number | null;
  isMissing: boolean;
  percentile: number | null;
  zscore: number | null;
  rankAmongPeers: number | null;
  peerCount: number;
  weight: number;
  weightedScore: number | null;
}

export const DEFAULT_CATEGORY_WEIGHTS: Record<MetricCategory, number> = {
  valuation: 0.3,
  profitability: 0.2,
  growth: 0.2,
  financialStrength: 0.15,
  capitalAllocation: 0.1,
  earningsQuality: 0.05,
  cashGeneration: 0,
  efficiency: 0,
  moat: 0,
};

/** Weighting applied across the trailing N years of a metric when building its multi-year score. */
export const DEFAULT_YEAR_WEIGHTS = [0.35, 0.25, 0.2, 0.1, 0.1] as const;
