import type { HeadlineMetrics } from "./company.js";
import type { MetricCategory, MetricDefinition } from "./metrics.js";
import { DEFAULT_YEAR_WEIGHTS, METRIC_CATEGORIES } from "./metrics.js";
import { getMetricRationale, type MetricVerdict } from "./metricRationale.js";
import type { CategoryScore, CoverageTier, RankingResult, RankingWeightsConfig, ScoreCoverage } from "./ranking.js";
import {
  percentileRanksInPlace,
  weightedAverageFrom,
  winsorizeInPlace,
  zscoreToUnitScore,
  zscoresInPlace,
} from "./rankingMath.js";
import { isMetricApplicable } from "./sectorApplicability.js";

export interface UniverseCompanyData {
  ticker: string;
  /** Used by sectorRelative metrics to group same-sector peers; companies with no sector on record are grouped together. */
  sector: string | null;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
}

export interface MetricYearStats {
  /** ticker -> direction-adjusted unit score (0-1, higher always means "better performing"). */
  scoreByTicker: Map<string, number>;
  /** ticker -> rank among peers for this metric+year, 1 = best. For a sectorRelative metric, "peers" means same-sector peers. */
  rankByTicker: Map<string, number>;
  /** ticker -> size of the peer group its rank/score were computed against (the whole universe with data, or its sector group for a sectorRelative metric). */
  peerCountByTicker: Map<string, number>;
}

export interface RankingComputation {
  results: RankingResult[];
  /**
   * metricKey -> yearIndex -> per-metric-year cross-sectional stats, needed by callers that persist
   * percentiles/ranks. Materialized lazily from the UnitScoreIndex on first read: building it costs
   * ~1.5M Map inserts, which the nightly job needs and the browser's live-reweighting path never
   * touches, so it must not be on the critical path of a slider drag.
   */
  metricUnitScores: Map<string, Map<number, MetricYearStats>>;
}

/**
 * Phase 1's output: every metric-year's cross-sectional normalization, in a flat, index-addressed
 * form. This is the expensive half of a recompute (winsorize + percentile/z-score over ~370
 * metric-year series) and it depends ONLY on:
 *
 *   - the universe (values and sectors),
 *   - the metric definitions (direction, negativeIsBad, sectorRelative, enabled),
 *   - `config.yearsIncluded`, `config.winsorizeLowerPct`, `config.winsorizeUpperPct`,
 *     `config.normalizationMethod`.
 *
 * It is INDEPENDENT of `config.categoryWeights` and `config.metricWeights`. That independence is
 * the point: a weight slider changes neither, so the client computes this once and reruns only
 * aggregateRankings while the slider moves.
 *
 * Every field is a plain array or typed array, so the whole thing is structured-cloneable and can
 * be posted to (or from) a Web Worker as-is.
 *
 * Addressing, for company `ci`, metric slab `mi`, year `y`:
 *   scores/ranks/peerCounts[ci * metricKeys.length * yearCount + mi * yearCount + y]
 * Company-major on purpose — the aggregation loop walks one company's whole metric-year block at a
 * time, and that block (74 x 5 doubles) fits comfortably in L1.
 */
export interface UnitScoreIndex {
  /** Layout version; bump when the addressing or sentinels change so a stale cached index is rejected rather than misread. */
  version: number;
  /** company index -> ticker, in the order the universe was supplied. */
  tickers: string[];
  /** slab index -> metric key. Exactly the enabled metrics, in the order they were supplied. */
  metricKeys: string[];
  companyCount: number;
  yearCount: number;
  /** Direction-adjusted unit score (0-1, higher = better), NaN where the company has no score for that metric-year. */
  scores: Float64Array;
  /** Rank within the peer group (1 = best), 0 where absent. */
  ranks: Int32Array;
  /** Size of the peer group the score was computed against, 0 where absent. */
  peerCounts: Int32Array;
  /** 1 where the metric-year had >= 2 usable values (so a MetricYearStats entry exists for it), else 0. Indexed `mi * yearCount + y`. */
  yearPresent: Uint8Array;
}

const UNIT_SCORE_INDEX_VERSION = 1;

/**
 * A metric's default per-metric weight within its category, used only when the caller's config
 * doesn't specify an explicit metricWeights override. Reuses the same verdict taxonomy admins
 * and users see in the Value Metrics panel / hover tooltips (shared/src/metricRationale.ts) so a
 * "use with caution" metric contributes less to the score by default than a "core" one, instead
 * of every metric in a category counting equally regardless of how well-grounded it is.
 * "not-value-investing" (currently only the 3 momentum metrics) stays at full weight here — the
 * primary exclusion mechanism for that is the momentum category's 0% default weight, not a
 * further per-metric penalty, so a user who deliberately turns momentum weighting on isn't also
 * fighting an extra hidden discount.
 */
export const VERDICT_DEFAULT_WEIGHT: Record<MetricVerdict, number> = {
  core: 1,
  supporting: 0.66,
  caveat: 0.33,
  "not-value-investing": 1,
};

/** The weight a metric gets when a caller's config doesn't specify an explicit override — exported so UI weight sliders can display a default that matches what the engine actually applies, instead of assuming a flat 100%. */
export function defaultMetricWeight(metric: MetricDefinition): number {
  return VERDICT_DEFAULT_WEIGHT[getMetricRationale(metric.key, metric.category).verdict];
}

/**
 * Minimum included/applicable ratio for each coverage tier. The cut points are judgement calls,
 * not derived: 0.7 is "most of what could be measured was measured", 0.4 is "enough to compare
 * but read the category breakdown". "thin" says the score rests on a small base — it is a
 * statement about the evidence, never about the company. A thin-coverage business can be an
 * excellent one; the score just isn't standing on much.
 */
export const COVERAGE_TIER_MIN_RATIO: Record<Exclude<CoverageTier, "thin">, number> = {
  full: 0.7,
  partial: 0.4,
};

function coverageTierFor(ratio: number): CoverageTier {
  if (ratio >= COVERAGE_TIER_MIN_RATIO.full) return "full";
  if (ratio >= COVERAGE_TIER_MIN_RATIO.partial) return "partial";
  return "thin";
}

function extractHeadlineMetrics(mostRecentYear: Record<string, number | null> | undefined): HeadlineMetrics {
  return {
    peTtm: mostRecentYear?.pe_ttm ?? null,
    evEbitda: mostRecentYear?.ev_ebitda ?? null,
    dividendYield: mostRecentYear?.dividend_yield ?? null,
    roic: mostRecentYear?.roic ?? null,
    fcfYield: mostRecentYear?.fcf_yield ?? null,
    revenueGrowth1y: mostRecentYear?.growth_revenue_1y ?? null,
  };
}

/**
 * (sector, metricKey) -> applicability. Module-scope and never invalidated because the underlying
 * map (shared/src/sectorApplicability.ts) is a static table: the answer for a given pair cannot
 * change at runtime. Both keys come from small closed sets (~a dozen sectors, ~70 metrics), so the
 * memo can't grow unbounded. Worth having: the engine asks this question ~100k times per recompute
 * and the uncached path re-normalizes the sector string every time.
 */
const APPLICABILITY_MEMO = new Map<string | null, Map<string, boolean>>();

function memoizedIsMetricApplicable(metricKey: string, sector: string | null): boolean {
  let bySector = APPLICABILITY_MEMO.get(sector);
  if (bySector === undefined) {
    bySector = new Map<string, boolean>();
    APPLICABILITY_MEMO.set(sector, bySector);
  }
  const cached = bySector.get(metricKey);
  if (cached !== undefined) return cached;
  const applicable = isMetricApplicable(metricKey, sector);
  bySector.set(metricKey, applicable);
  return applicable;
}

/**
 * One row of applicability flags per distinct sector string, shared by every company in it, so a
 * 1,300-company universe over a dozen sectors builds a dozen rows instead of 1,300.
 */
function applicabilityRowsByCompany(universe: UniverseCompanyData[], metricKeys: string[]): Uint8Array[] {
  const rowBySector = new Map<string | null, Uint8Array>();
  const rows: Uint8Array[] = new Array(universe.length);
  for (let ci = 0; ci < universe.length; ci++) {
    const sector = universe[ci].sector;
    let row = rowBySector.get(sector);
    if (row === undefined) {
      row = new Uint8Array(metricKeys.length);
      for (let mi = 0; mi < metricKeys.length; mi++) {
        row[mi] = memoizedIsMetricApplicable(metricKeys[mi], sector) ? 1 : 0;
      }
      rowBySector.set(sector, row);
    }
    rows[ci] = row;
  }
  return rows;
}

/**
 * Every positive-value company must outrank every negative-value one for a negativeIsBad metric,
 * regardless of magnitude, so the two sign groups are scored onto non-overlapping bands: positives
 * land in [0.5, 1] and negatives in [0, 0.5 - 1e-9].
 */
const NEG_CEILING = 0.5 - 1e-9;

/** Reusable working buffers for phase 1 — allocated once per computeUnitScores call, never inside the metric-year loop. */
interface GroupScratch {
  memberIdx: Int32Array;
  memberVal: Float64Array;
  bucketIdx: Int32Array;
  bucketVal: Float64Array;
  splitVal: Float64Array;
  splitLocal: Int32Array;
  work: Float64Array;
  sortScratch: Float64Array;
  normalized: Float64Array;
  groupScore: Float64Array;
  order: number[];
  rankOrder: number[];
}

/** winsorize -> percentile-or-zscore over `src[offset .. offset+n)`, writing 0-1 unit scores (not yet direction-adjusted) into `scratch.normalized`. */
function normalizeGroup(
  src: Float64Array,
  offset: number,
  n: number,
  config: RankingWeightsConfig,
  scratch: GroupScratch,
): void {
  const work = scratch.work;
  for (let i = 0; i < n; i++) work[i] = src[offset + i];
  winsorizeInPlace(work, n, config.winsorizeLowerPct, config.winsorizeUpperPct, scratch.sortScratch);
  const out = scratch.normalized;
  if (config.normalizationMethod === "percentile") {
    percentileRanksInPlace(work, n, out, scratch.order);
  } else {
    zscoresInPlace(work, n, out);
    for (let i = 0; i < n; i++) out[i] = zscoreToUnitScore(out[i]);
  }
}

/**
 * Writes peer ranks for one already-normalized (sub)group without sorting again.
 *
 * Percentile normalization hands every member a distinct score — `rank / (n - 1)` over a stable
 * ascending permutation — so the descending-score order is just that permutation, forwards or
 * backwards depending on whether the score rises or falls with the underlying value. There are no
 * ties left to break, which is what makes this exactly equal to the general sort it replaces, and
 * it removes one full comparator sort per peer group per metric-year.
 *
 * `subLocal` maps a sub-group position back to a position within the peer group (the negativeIsBad
 * sign split), or null when the sub-group *is* the peer group. `rankBase` offsets the negative
 * sign group below every positive one.
 */
function writeDerivedRanks(
  scratch: GroupScratch,
  start: number,
  subCount: number,
  subLocal: Int32Array | null,
  ascendingScore: boolean,
  rankBase: number,
  index: UnitScoreIndex,
  slabOffset: number,
  stride: number,
): void {
  const { memberIdx, order } = scratch;
  const ranks = index.ranks;
  for (let r = 0; r < subCount; r++) {
    const sub = ascendingScore ? order[subCount - 1 - r] : order[r];
    const local = subLocal === null ? sub : subLocal[sub];
    ranks[memberIdx[start + local] * stride + slabOffset] = rankBase + r + 1;
  }
}

/**
 * Scores + ranks one peer group (the whole universe with data for a normal metric, or one sector's
 * companies for a sectorRelative metric) for a single metric+year, writing straight into the
 * index's slabs. Members are `scratch.memberIdx[start .. start+count)` (company indices, ascending)
 * with values in `scratch.memberVal`.
 */
function scoreGroup(
  scratch: GroupScratch,
  start: number,
  count: number,
  metric: MetricDefinition,
  config: RankingWeightsConfig,
  index: UnitScoreIndex,
  slabOffset: number,
  stride: number,
): void {
  if (count < 2) return; // too few peers to rank meaningfully this year — leave missing, not a fabricated rank of 1/1

  const { memberIdx, memberVal, splitVal, splitLocal, normalized, groupScore } = scratch;
  const flip = metric.direction === "asc";
  const derivedRanks = config.normalizationMethod === "percentile";

  let positiveCount = 0;
  if (metric.negativeIsBad) {
    for (let i = 0; i < count; i++) {
      if (memberVal[start + i] > 0) positiveCount++;
    }
  } else {
    positiveCount = count;
  }

  if (positiveCount === count || positiveCount === 0) {
    // No split needed: either negativeIsBad doesn't apply, every company is positive this year, or
    // every company is negative. In the all-negative case "closer to zero is less bad" replaces the
    // metric's normal direction — a smaller loss should still score better than a larger one.
    normalizeGroup(memberVal, start, count, config, scratch);
    const ascendingScore = positiveCount === 0 || !flip;
    if (positiveCount === 0) {
      for (let i = 0; i < count; i++) groupScore[i] = normalized[i];
    } else {
      for (let i = 0; i < count; i++) groupScore[i] = flip ? 1 - normalized[i] : normalized[i];
    }
    if (derivedRanks) writeDerivedRanks(scratch, start, count, null, ascendingScore, 0, index, slabOffset, stride);
  } else {
    // Positive group keeps the metric's normal direction and lands in [0.5, 1]; negative group is
    // scored by closeness to zero and lands in [0, 0.5 - 1e-9] — the two ranges never overlap.
    let n = 0;
    for (let i = 0; i < count; i++) {
      const v = memberVal[start + i];
      if (v > 0) {
        splitLocal[n] = i;
        splitVal[n] = v;
        n++;
      }
    }
    normalizeGroup(splitVal, 0, n, config, scratch);
    for (let j = 0; j < n; j++) {
      const directional = flip ? 1 - normalized[j] : normalized[j];
      groupScore[splitLocal[j]] = 0.5 + 0.5 * directional;
    }
    // Emitted before the negative pass reuses splitLocal and scratch.order.
    if (derivedRanks) writeDerivedRanks(scratch, start, n, splitLocal, !flip, 0, index, slabOffset, stride);
    const rankBase = n;

    n = 0;
    for (let i = 0; i < count; i++) {
      const v = memberVal[start + i];
      if (v <= 0) {
        splitLocal[n] = i;
        splitVal[n] = v;
        n++;
      }
    }
    normalizeGroup(splitVal, 0, n, config, scratch);
    for (let j = 0; j < n; j++) groupScore[splitLocal[j]] = normalized[j] * NEG_CEILING;
    if (derivedRanks) writeDerivedRanks(scratch, start, n, splitLocal, true, rankBase, index, slabOffset, stride);
  }

  const { scores, ranks, peerCounts } = index;
  for (let i = 0; i < count; i++) {
    const at = memberIdx[start + i] * stride + slabOffset;
    scores[at] = groupScore[i];
    peerCounts[at] = count;
  }
  if (derivedRanks) return;

  // z-score normalization maps equal values onto equal scores, so ranks genuinely have ties to
  // break. Stable descending sort over ascending member positions breaks them by original
  // position, which is what the peer-group insertion order used to do.
  const rankOrder = scratch.rankOrder;
  rankOrder.length = count;
  for (let i = 0; i < count; i++) rankOrder[i] = i;
  rankOrder.sort((a, b) => groupScore[b] - groupScore[a]);
  for (let r = 0; r < count; r++) {
    ranks[memberIdx[start + rankOrder[r]] * stride + slabOffset] = r + 1;
  }
}

/**
 * Phase 1 of the ranking engine: for each enabled metric x fiscal-year-index, normalizes raw values
 * across every company that has one (winsorize, then percentile or z-score, sector-grouped first
 * for sectorRelative metrics) and flips direction for "asc" metrics.
 *
 * Companies a metric can't describe (see sectorApplicability.ts) are left out of its peer group
 * entirely, not just out of their own score — otherwise everyone else's percentile is computed
 * against a distribution that includes values the accounting never supported.
 *
 * See UnitScoreIndex for exactly which config fields this depends on, and why the ones it doesn't
 * depend on (the weights) are the reason this phase is separately cacheable.
 */
export function computeUnitScores(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): UnitScoreIndex {
  const enabledMetrics = metrics.filter((m) => m.enabled);
  const metricKeys = enabledMetrics.map((m) => m.key);
  const companyCount = universe.length;
  const metricCount = metricKeys.length;
  const yearCount = config.yearsIncluded;
  const stride = metricCount * yearCount;

  const index: UnitScoreIndex = {
    version: UNIT_SCORE_INDEX_VERSION,
    tickers: universe.map((c) => c.ticker),
    metricKeys,
    companyCount,
    yearCount,
    scores: new Float64Array(companyCount * stride).fill(NaN),
    ranks: new Int32Array(companyCount * stride),
    peerCounts: new Int32Array(companyCount * stride),
    yearPresent: new Uint8Array(metricCount * yearCount),
  };
  if (companyCount === 0 || metricCount === 0) return index;

  const applicability = applicabilityRowsByCompany(universe, metricKeys);

  // Year-major view of the raw records so the gather loop doesn't re-walk `universe[ci].byYear`.
  const recordsByYear: Array<Array<Record<string, number | null> | undefined>> = [];
  for (let y = 0; y < yearCount; y++) {
    const row: Array<Record<string, number | null> | undefined> = new Array(companyCount);
    for (let ci = 0; ci < companyCount; ci++) row[ci] = universe[ci].byYear[y];
    recordsByYear.push(row);
  }

  // Raw sector string identifies a peer group for sectorRelative metrics — deliberately not
  // canonicalized, matching the original grouping (companies with no sector on record group together).
  const sectorGroupId = new Int32Array(companyCount);
  const groupIdBySector = new Map<string | null, number>();
  for (let ci = 0; ci < companyCount; ci++) {
    const sector = universe[ci].sector ?? null;
    let id = groupIdBySector.get(sector);
    if (id === undefined) {
      id = groupIdBySector.size;
      groupIdBySector.set(sector, id);
    }
    sectorGroupId[ci] = id;
  }
  const sectorCount = groupIdBySector.size;
  const bucketCounts = new Int32Array(sectorCount);
  const bucketStarts = new Int32Array(sectorCount + 1);
  const bucketCursor = new Int32Array(sectorCount);

  const scratch: GroupScratch = {
    memberIdx: new Int32Array(companyCount),
    memberVal: new Float64Array(companyCount),
    bucketIdx: new Int32Array(companyCount),
    bucketVal: new Float64Array(companyCount),
    splitVal: new Float64Array(companyCount),
    splitLocal: new Int32Array(companyCount),
    work: new Float64Array(companyCount),
    sortScratch: new Float64Array(companyCount),
    normalized: new Float64Array(companyCount),
    groupScore: new Float64Array(companyCount),
    order: [],
    rankOrder: [],
  };
  const applicableIdx = new Int32Array(companyCount);

  for (let mi = 0; mi < metricCount; mi++) {
    const metric = enabledMetrics[mi];
    const key = metric.key;

    let applicableCount = 0;
    for (let ci = 0; ci < companyCount; ci++) {
      if (applicability[ci][mi] === 1) applicableIdx[applicableCount++] = ci;
    }
    if (applicableCount < 2) continue;

    for (let y = 0; y < yearCount; y++) {
      const records = recordsByYear[y];
      let n = 0;
      for (let k = 0; k < applicableCount; k++) {
        const ci = applicableIdx[k];
        const record = records[ci];
        if (record === undefined) continue;
        const value = record[key];
        // Also rejects undefined (a key the record simply doesn't carry) and NaN/Infinity.
        if (value === null || !Number.isFinite(value)) continue;
        scratch.memberIdx[n] = ci;
        scratch.memberVal[n] = value;
        n++;
      }
      if (n < 2) continue;

      const slabOffset = mi * yearCount + y;
      index.yearPresent[slabOffset] = 1;

      if (!metric.sectorRelative) {
        scoreGroup(scratch, 0, n, metric, config, index, slabOffset, stride);
        continue;
      }

      // Counting sort into contiguous per-sector runs, preserving each sector's internal ordering.
      bucketCounts.fill(0);
      for (let i = 0; i < n; i++) bucketCounts[sectorGroupId[scratch.memberIdx[i]]]++;
      let running = 0;
      for (let g = 0; g < sectorCount; g++) {
        bucketStarts[g] = running;
        bucketCursor[g] = running;
        running += bucketCounts[g];
      }
      bucketStarts[sectorCount] = running;
      for (let i = 0; i < n; i++) {
        const ci = scratch.memberIdx[i];
        const at = bucketCursor[sectorGroupId[ci]]++;
        scratch.bucketIdx[at] = ci;
        scratch.bucketVal[at] = scratch.memberVal[i];
      }
      scratch.memberIdx.set(scratch.bucketIdx.subarray(0, n));
      scratch.memberVal.set(scratch.bucketVal.subarray(0, n));
      for (let g = 0; g < sectorCount; g++) {
        if (bucketCounts[g] < 2) continue;
        scoreGroup(scratch, bucketStarts[g], bucketCounts[g], metric, config, index, slabOffset, stride);
      }
    }
  }

  return index;
}

/** Rebuilds the ticker-keyed MetricYearStats view the persistence layer reads. ~1.5M Map inserts at production scale — see RankingComputation. */
function materializeMetricUnitScores(index: UnitScoreIndex): Map<string, Map<number, MetricYearStats>> {
  const { metricKeys, tickers, companyCount, yearCount, scores, ranks, peerCounts, yearPresent } = index;
  const stride = metricKeys.length * yearCount;
  const out = new Map<string, Map<number, MetricYearStats>>();

  for (let mi = 0; mi < metricKeys.length; mi++) {
    const perYear = new Map<number, MetricYearStats>();
    for (let y = 0; y < yearCount; y++) {
      const slabOffset = mi * yearCount + y;
      if (yearPresent[slabOffset] === 0) continue;
      const scoreByTicker = new Map<string, number>();
      const rankByTicker = new Map<string, number>();
      const peerCountByTicker = new Map<string, number>();
      for (let ci = 0; ci < companyCount; ci++) {
        const at = ci * stride + slabOffset;
        const score = scores[at];
        if (Number.isNaN(score)) continue;
        const ticker = tickers[ci];
        scoreByTicker.set(ticker, score);
        rankByTicker.set(ticker, ranks[at]);
        peerCountByTicker.set(ticker, peerCounts[at]);
      }
      perYear.set(y, { scoreByTicker, rankByTicker, peerCountByTicker });
    }
    out.set(metricKeys[mi], perYear);
  }
  return out;
}

/**
 * Phase 2 of the ranking engine: the weighted rollup. Blends each metric's per-year unit scores
 * using DEFAULT_YEAR_WEIGHTS (35/25/20/10/10) renormalized over whichever years are actually
 * present, rolls metrics into category scores (weighted by each metric's verdict-based default or
 * a caller override), and rolls category scores into the overall score using categoryWeights
 * (renormalized over categories that have data for that company). Each result carries a `coverage`
 * summary of how much of its applicable metric set actually fed the score.
 *
 * Reads only `config.categoryWeights`, `config.metricWeights` and `config.yearsIncluded` (the last
 * only to bound the year loop), so a cached UnitScoreIndex can be reused across any pure weight
 * change. An index built with a larger `yearsIncluded` is also valid for a smaller one — each
 * metric-year is normalized independently — but changing the winsorization or normalization method
 * invalidates it.
 */
export function aggregateRankings(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
  unitScores: UnitScoreIndex,
): RankingComputation {
  if (unitScores.companyCount !== universe.length) {
    throw new Error(
      `aggregateRankings: unit score index covers ${unitScores.companyCount} companies but the universe has ${universe.length}`,
    );
  }

  const enabledMetrics = metrics.filter((m) => m.enabled);
  const metricCount = enabledMetrics.length;
  const companyCount = universe.length;
  const yearCount = unitScores.yearCount;
  const stride = unitScores.metricKeys.length * yearCount;
  const yearsIncluded = Math.min(config.yearsIncluded, yearCount);

  const slabByKey = new Map<string, number>();
  for (let i = 0; i < unitScores.metricKeys.length; i++) slabByKey.set(unitScores.metricKeys[i], i);

  // Per-metric weight is a pure function of the config and the registry, so resolve it once for the
  // whole universe rather than ~500k times inside the loop (getMetricRationale is not free).
  const metricWeight = new Float64Array(metricCount);
  const metricSlab = new Int32Array(metricCount);
  const overrides = config.metricWeights;
  for (let mi = 0; mi < metricCount; mi++) {
    const metric = enabledMetrics[mi];
    const override = overrides?.[metric.key];
    metricWeight[mi] = override ?? defaultMetricWeight(metric);
    metricSlab[mi] = slabByKey.get(metric.key) ?? -1;
  }

  const categoryCount = METRIC_CATEGORIES.length;
  const metricsByCategory: number[][] = METRIC_CATEGORIES.map(() => []);
  const categoryIndex = new Map<MetricCategory, number>(METRIC_CATEGORIES.map((c, i) => [c, i]));
  for (let mi = 0; mi < metricCount; mi++) {
    const at = categoryIndex.get(enabledMetrics[mi].category);
    if (at !== undefined) metricsByCategory[at].push(mi);
  }
  const categoryWeight = new Float64Array(categoryCount);
  for (let c = 0; c < categoryCount; c++) categoryWeight[c] = config.categoryWeights[METRIC_CATEGORIES[c]];

  const yearWeight = new Float64Array(yearsIncluded);
  for (let y = 0; y < yearsIncluded; y++) yearWeight[y] = DEFAULT_YEAR_WEIGHTS[y] ?? 0;

  const applicability = applicabilityRowsByCompany(
    universe,
    enabledMetrics.map((m) => m.key),
  );

  const scores = unitScores.scores;
  const yearScoreBuf = new Float64Array(yearsIncluded);
  const yearWeightBuf = new Float64Array(yearsIncluded);
  const metricScoreBuf = new Float64Array(metricCount);
  const metricWeightBuf = new Float64Array(metricCount);
  const categoryScoreBuf = new Float64Array(categoryCount);
  const categoryWeightBuf = new Float64Array(categoryCount);

  const computedAt = new Date().toISOString();
  const results: RankingResult[] = new Array(companyCount);

  for (let ci = 0; ci < companyCount; ci++) {
    const company = universe[ci];
    const applicableRow = applicability[ci];
    const companyBase = ci * stride;

    const categoryScores: CategoryScore[] = new Array(categoryCount);
    let scoringCategoryCount = 0;
    let coverageIncluded = 0;
    let coverageMissing = 0;

    for (let c = 0; c < categoryCount; c++) {
      const members = metricsByCategory[c];
      let included = 0;
      let missing = 0;
      let notApplicable = 0;

      for (let m = 0; m < members.length; m++) {
        const mi = members[m];
        if (applicableRow[mi] === 0) {
          notApplicable++;
          continue;
        }
        const weight = metricWeight[mi];
        if (weight <= 0) {
          missing++;
          continue;
        }
        const slab = metricSlab[mi];
        if (slab < 0) {
          missing++;
          continue;
        }

        const slabBase = companyBase + slab * yearCount;
        let yearsPresent = 0;
        for (let y = 0; y < yearsIncluded; y++) {
          const score = scores[slabBase + y];
          if (score !== score) continue; // NaN sentinel: no score for this metric-year
          yearScoreBuf[yearsPresent] = score;
          yearWeightBuf[yearsPresent] = yearWeight[y];
          yearsPresent++;
        }
        if (yearsPresent === 0) {
          missing++;
          continue;
        }
        const multiYearScore = weightedAverageFrom(yearScoreBuf, yearWeightBuf, yearsPresent);
        if (multiYearScore === null) {
          missing++;
          continue;
        }
        metricScoreBuf[included] = multiYearScore;
        metricWeightBuf[included] = weight;
        included++;
      }

      const categoryScore = weightedAverageFrom(metricScoreBuf, metricWeightBuf, included);
      const weight = categoryWeight[c];
      categoryScores[c] = {
        category: METRIC_CATEGORIES[c],
        score: categoryScore,
        weight,
        metricsIncluded: included,
        metricsMissing: missing,
        metricsNotApplicable: notApplicable,
      };

      // Coverage counts only categories the caller actually weights: a category at 0% (momentum,
      // by default) contributes nothing to the score, so counting its metrics would inflate the
      // apparent basis of a score they never touched. Inapplicable metrics are already excluded
      // above, so a bank's cashGeneration category — entirely inapplicable — contributes to
      // neither side of the ratio rather than dragging it down.
      if (weight > 0) {
        coverageIncluded += included;
        coverageMissing += missing;
        if (categoryScore !== null) {
          categoryScoreBuf[scoringCategoryCount] = categoryScore;
          categoryWeightBuf[scoringCategoryCount] = weight;
          scoringCategoryCount++;
        }
      }
    }

    const categoryAverage = weightedAverageFrom(categoryScoreBuf, categoryWeightBuf, scoringCategoryCount);
    const metricsApplicable = coverageIncluded + coverageMissing;
    const ratio = metricsApplicable > 0 ? coverageIncluded / metricsApplicable : 0;
    const coverage: ScoreCoverage = {
      metricsIncluded: coverageIncluded,
      metricsApplicable,
      ratio,
      tier: coverageTierFor(ratio),
    };

    results[ci] = {
      ticker: company.ticker,
      computedAt,
      overallScore: categoryAverage !== null ? categoryAverage * 100 : null,
      overallRank: null,
      peerCount: companyCount,
      categoryScores,
      weightsUsed: config,
      headlineMetrics: extractHeadlineMetrics(company.byYear[0]),
      coverage,
    };
  }

  const ranked = results
    .filter((r) => r.overallScore !== null)
    .sort((a, b) => (b.overallScore as number) - (a.overallScore as number));
  ranked.forEach((r, idx) => {
    r.overallRank = idx + 1;
  });

  let materialized: Map<string, Map<number, MetricYearStats>> | null = null;
  const computation = { results } as RankingComputation;
  Object.defineProperty(computation, "metricUnitScores", {
    enumerable: true,
    configurable: true,
    get(): Map<string, Map<number, MetricYearStats>> {
      if (materialized === null) materialized = materializeMetricUnitScores(unitScores);
      return materialized;
    },
  });
  return computation;
}

/**
 * Cross-sectional ranking engine, pure (no I/O) — computeUnitScores followed by aggregateRankings.
 * Callers that recompute repeatedly while only the weights change (the Rankings page's live
 * sliders) should call the two halves directly and cache the UnitScoreIndex; this wrapper exists
 * for the one-shot callers (the nightly job, tests) and is the stable entry point both sides have
 * always used.
 *
 * Lives in shared/ so the exact same implementation runs both server-side
 * (functions/src/ranking/rankingEngine.ts, the nightly job) and client-side
 * (web/src/lib/clientRankingEngine.ts, the Rankings page's instant live-reweighting preview) —
 * they must agree bit-for-bit.
 */
export function computeCrossSectionalRankings(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): RankingComputation {
  return aggregateRankings(universe, metrics, config, computeUnitScores(universe, metrics, config));
}
