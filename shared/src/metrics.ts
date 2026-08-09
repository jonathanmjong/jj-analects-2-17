export type MetricCategory =
  | "valuation"
  | "momentum"
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
  "momentum",
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
  /**
   * True for ratio metrics where a negative value comes from a negative
   * denominator (net income, EBITDA, EBIT, equity) rather than being a
   * continuation of "lower is better" — e.g. a P/E of -50 (deep losses)
   * isn't a cheaper stock than a P/E of 5, it's a fundamentally worse one.
   * When set, every negative-value company ranks below every positive-value
   * company for this metric+year, regardless of magnitude; only within each
   * sign group does normal "asc" ordering apply (and within the negative
   * group, closer-to-zero — i.e. a smaller loss — still ranks better than a
   * larger one). Leave unset for metrics where negative is intentionally
   * the good end (e.g. share buybacks shrinking share count) or can't occur.
   */
  negativeIsBad?: boolean;
  /**
   * True for metrics that are only meaningful compared within the same sector — e.g. asset
   * turnover: a retailer and a software company have structurally different "normal" turnover
   * ratios for reasons that have nothing to do with which is the better investment. When set,
   * computeCrossSectionalRankings percentile-ranks each company against same-sector peers only
   * (companies with no sector on record are grouped together), not the whole universe.
   */
  sectorRelative?: boolean;
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
};

/** Weighting applied across the trailing N years of a metric when building its multi-year score. */
export const DEFAULT_YEAR_WEIGHTS = [0.35, 0.25, 0.2, 0.1, 0.1] as const;
