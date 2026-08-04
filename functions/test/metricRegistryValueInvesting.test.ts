import { describe, expect, it } from "vitest";
import type { MetricDefinition, UniverseCompanyData } from "@proverbs/shared";
import {
  computeCrossSectionalRankings,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_RANKING_CONFIG,
  getMetricRationale,
  METRIC_CATEGORIES,
} from "@proverbs/shared";
import { METRIC_DEFINITIONS } from "../src/metrics/definitions.js";

/**
 * Guardrail suite for the metric registry, not the individual calculator math (see
 * metrics.test.ts for that). Three questions, each with its own describe block:
 *  1. Is every metric structurally sound (valid category/direction/unit, has a rationale)?
 *  2. Are metrics whose sign carries real economic meaning (P/E, EV/EBITDA, leverage ratios)
 *     correctly flagged negativeIsBad, so a future metric addition can't reintroduce the
 *     "negative P/E ranks as cheapest" bug fixed in shared/src/rankingEngineCore.ts?
 *  3. Do the category weights actually reflect this app's stated value-investing philosophy
 *     (e.g. momentum excluded by default), and does that weighting produce correctly-ordered
 *     rankings end-to-end for a real negativeIsBad metric from the live registry?
 */

describe("metric registry — structural integrity", () => {
  it("every metric has a category in METRIC_CATEGORIES", () => {
    for (const m of METRIC_DEFINITIONS) {
      expect(METRIC_CATEGORIES, `${m.key} has unknown category "${m.category}"`).toContain(m.category);
    }
  });

  it("every metric has a non-empty label, description, and a valid direction/unit", () => {
    for (const m of METRIC_DEFINITIONS) {
      expect(m.label.length, `${m.key} has an empty label`).toBeGreaterThan(0);
      expect(m.description.length, `${m.key} has an empty description`).toBeGreaterThan(0);
      expect(["asc", "desc"], `${m.key} has invalid direction`).toContain(m.direction);
      expect(["ratio", "percent", "multiple", "currency", "years"], `${m.key} has invalid unit`).toContain(m.unit);
    }
  });

  it("no duplicate metric keys", () => {
    const keys = METRIC_DEFINITIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every enabled category has at least one enabled metric", () => {
    for (const category of METRIC_CATEGORIES) {
      const count = METRIC_DEFINITIONS.filter((m) => m.category === category && m.enabled).length;
      expect(count, `category "${category}" has no enabled metrics`).toBeGreaterThan(0);
    }
  });

  it("every metric has real value-investing rationale content, not the generic fallback", () => {
    // Forces a conscious documentation step (functions/src/metrics/definitions.ts +
    // shared/src/metricRationale.ts, both edited together) whenever a metric is added —
    // this is the concrete "ensure all value metrics align with value investing principles"
    // check: a metric can't silently ship without someone stating whether it's sound.
    for (const m of METRIC_DEFINITIONS) {
      const info = getMetricRationale(m.key, m.category);
      expect(info.rationale, `${m.key} has no metric-specific rationale — add one to shared/src/metricRationale.ts`).not.toBe(
        "No metric-specific note yet — see the category summary above.",
      );
    }
  });
});

describe("metric registry — negativeIsBad correctness", () => {
  // These metrics are a ratio of a positive numerator (price, enterprise value, or debt) over
  // a denominator that can genuinely go negative (net income, EBIT, EBITDA, equity) — a
  // negative reading means the company has losses or negative equity, not that it's "cheap" or
  // "unlevered". Every metric matching this economic shape MUST be flagged negativeIsBad, or
  // the ranking engine's plain ascending sort will treat the worst losses as the best scores
  // (the exact bug fixed 2026-08-03 — see shared/src/rankingEngineCore.ts's commit history).
  const RATIO_OVER_POSSIBLY_NEGATIVE_DENOMINATOR = new Set([
    "ev_fcf",
    "ev_ebit",
    "ev_ebitda",
    "pe_ttm",
    "pb",
    "ps",
    "price_tangible_book",
    "debt_to_equity",
    "debt_to_ebitda",
  ]);

  // Metrics where "asc" (lower raw value is better) genuinely includes negative as the GOOD
  // end — buybacks shrinking share count, a negative (efficient) cash conversion cycle,
  // negative (cash-backed) accruals. These must NOT be negativeIsBad.
  const ASC_METRICS_WHERE_NEGATIVE_IS_INTENTIONALLY_GOOD = new Set([
    "share_count_change",
    "cash_conversion_cycle",
    "accrual_ratio",
    "capex_to_revenue",
    "revenue_volatility",
    "eps_volatility",
  ]);

  it("every known ratio-over-possibly-negative-denominator metric is flagged negativeIsBad", () => {
    for (const key of RATIO_OVER_POSSIBLY_NEGATIVE_DENOMINATOR) {
      const metric = METRIC_DEFINITIONS.find((m) => m.key === key);
      expect(metric, `expected metric "${key}" to exist in the registry`).toBeDefined();
      expect(metric?.negativeIsBad, `${key} should have negativeIsBad: true`).toBe(true);
    }
  });

  it("intentional-negative-is-good metrics are NOT flagged negativeIsBad", () => {
    for (const key of ASC_METRICS_WHERE_NEGATIVE_IS_INTENTIONALLY_GOOD) {
      const metric = METRIC_DEFINITIONS.find((m) => m.key === key);
      expect(metric, `expected metric "${key}" to exist in the registry`).toBeDefined();
      expect(metric?.negativeIsBad, `${key} should NOT have negativeIsBad: true`).not.toBe(true);
    }
  });

  it("no valuation or financialStrength 'asc' metric is missing negativeIsBad unless explicitly reviewed", () => {
    // Every metric in these two categories with direction "asc" observed at the time this test
    // was written is a price/EV/debt ratio over a denominator that can go negative — so this
    // rule currently has zero exceptions. If a future metric addition trips this, it means
    // either negativeIsBad needs to be set, or (rare) the metric is a genuine exception and
    // should be added to ASC_METRICS_WHERE_NEGATIVE_IS_INTENTIONALLY_GOOD above after review —
    // the point is forcing that decision to be conscious, not silent.
    const suspects = METRIC_DEFINITIONS.filter(
      (m) =>
        (m.category === "valuation" || m.category === "financialStrength") &&
        m.direction === "asc" &&
        !m.negativeIsBad &&
        !ASC_METRICS_WHERE_NEGATIVE_IS_INTENTIONALLY_GOOD.has(m.key),
    );
    expect(suspects.map((m) => m.key), "unreviewed asc metric(s) in valuation/financialStrength missing negativeIsBad").toEqual([]);
  });
});

describe("metric registry — weighting reflects the stated value-investing philosophy", () => {
  it("default category weights sum to exactly 1", () => {
    const sum = Object.values(DEFAULT_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("momentum is explicitly excluded (0% weight) by default — it is not a value-investing signal", () => {
    expect(DEFAULT_CATEGORY_WEIGHTS.momentum).toBe(0);
  });

  it("valuation carries the largest default weight, consistent with it being the 'core' category", () => {
    const max = Math.max(...Object.values(DEFAULT_CATEGORY_WEIGHTS));
    expect(DEFAULT_CATEGORY_WEIGHTS.valuation).toBe(max);
  });

  it("every negativeIsBad metric in the live registry ranks a solid positive value above a deep-loss negative value", () => {
    // End-to-end check tying the flag to actual ranking behavior for EVERY real
    // negativeIsBad metric currently in the registry, not just one synthetic example
    // (see shared's negativeIsBadRanking.test.ts for the synthetic/edge-case coverage).
    const negativeIsBadMetrics = METRIC_DEFINITIONS.filter((m) => m.negativeIsBad);
    expect(negativeIsBadMetrics.length).toBeGreaterThan(0);

    for (const metric of negativeIsBadMetrics) {
      const universe: UniverseCompanyData[] = [
        { ticker: "PROFITABLE", byYear: [{ [metric.key]: 5 }] },
        { ticker: "EXPENSIVE_BUT_PROFITABLE", byYear: [{ [metric.key]: 50 }] },
        { ticker: "DEEP_LOSSES", byYear: [{ [metric.key]: -500 }] },
      ];
      const config = {
        ...DEFAULT_RANKING_CONFIG,
        categoryWeights: Object.fromEntries(
          METRIC_CATEGORIES.map((c) => [c, c === metric.category ? 1 : 0]),
        ) as typeof DEFAULT_RANKING_CONFIG.categoryWeights,
        yearsIncluded: 1 as const,
        winsorizeLowerPct: 0,
        winsorizeUpperPct: 1,
      };
      const { metricUnitScores } = computeCrossSectionalRankings(universe, [metric] as MetricDefinition[], config);
      const stats = metricUnitScores.get(metric.key)!.get(0)!;
      const profitableScore = stats.scoreByTicker.get("PROFITABLE")!;
      const lossScore = stats.scoreByTicker.get("DEEP_LOSSES")!;
      expect(profitableScore, `${metric.key}: a positive value should score above a deep-loss negative value`).toBeGreaterThan(lossScore);
    }
  });
});
