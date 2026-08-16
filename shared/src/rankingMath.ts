/**
 * Pure cross-sectional ranking math — no I/O, no Firestore, no fetch. Lives
 * in shared/ specifically so the exact same implementation runs both
 * server-side (the nightly ranking engine) and client-side (the instant
 * live-reweighting preview on the Rankings page), which must agree.
 *
 * Each routine exists twice: an `Array`-shaped version (the readable public
 * API, used by callers outside the engine) and an in-place `Float64Array`
 * twin the engine's hot loop calls ~370 times per recompute without
 * allocating. The array versions are thin wrappers over the in-place ones so
 * there is exactly one implementation of each algorithm — the two can never
 * drift apart and start scoring the same company differently on the server
 * than in the browser.
 */

/**
 * Clamps the first `n` entries of `values` to the winsorization bounds, in place.
 * `sortScratch` is caller-owned working space and must hold at least `n` entries;
 * its contents are not meaningful on return.
 */
export function winsorizeInPlace(
  values: Float64Array,
  n: number,
  lowerPct: number,
  upperPct: number,
  sortScratch: Float64Array,
): void {
  if (n < 2) return;
  for (let i = 0; i < n; i++) sortScratch[i] = values[i];
  const sorted = sortScratch.subarray(0, n);
  sorted.sort();
  const lowerBound = sorted[Math.floor(lowerPct * (n - 1))];
  const upperBound = sorted[Math.ceil(upperPct * (n - 1))];
  for (let i = 0; i < n; i++) {
    values[i] = Math.min(Math.max(values[i], lowerBound), upperBound);
  }
}

export function winsorize(values: number[], lowerPct: number, upperPct: number): number[] {
  const n = values.length;
  if (n < 2) return values;
  const buf = Float64Array.from(values);
  winsorizeInPlace(buf, n, lowerPct, upperPct, new Float64Array(n));
  return Array.from(buf);
}

/**
 * Ascending comparator for "negativeIsBad" ratio metrics (see MetricDefinition) outside the
 * main ranking engine — e.g. a raw UI table column sort. Positive values always sort before
 * negative ones (ascending within each: lowest positive first, then closest-to-zero negative
 * first), and missing values always sort last. Mirrors the split-group logic in
 * computeCrossSectionalRankings so a manual column sort agrees with the computed ranking.
 */
export function compareNegativeIsBad(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const aBad = a <= 0;
  const bBad = b <= 0;
  if (aBad !== bBad) return aBad ? 1 : -1;
  return aBad ? b - a : a - b;
}

/**
 * Writes each of the first `n` values' percentile rank (0-1) into `out`, order-preserved with
 * the input. `orderScratch` is caller-owned working space; it is resized to `n` and overwritten.
 *
 * Ties matter here and are resolved by original position: winsorization deliberately collapses
 * the tails onto a shared bound, so a large block of exactly-equal values is the normal case, not
 * an edge case. The sort must therefore stay a stable `Array.prototype.sort` over an
 * ascending-index array — `%TypedArray%.prototype.sort` is not a safe substitute.
 *
 * On return `orderScratch[0..n)` holds that ascending permutation, which the engine reuses to
 * derive peer ranks without a second sort (see scoreGroup).
 */
export function percentileRanksInPlace(values: Float64Array, n: number, out: Float64Array, orderScratch: number[]): void {
  if (n === 0) return;
  if (n === 1) {
    out[0] = 1;
    orderScratch.length = 1;
    orderScratch[0] = 0;
    return;
  }
  orderScratch.length = n;
  for (let i = 0; i < n; i++) orderScratch[i] = i;
  orderScratch.sort((a, b) => values[a] - values[b]);
  const denominator = n - 1;
  for (let rank = 0; rank < n; rank++) out[orderScratch[rank]] = rank / denominator;
}

/** Percentile rank (0-1) of each value within the peer set, order-preserved with input. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const out = new Float64Array(n);
  percentileRanksInPlace(Float64Array.from(values), n, out, []);
  return Array.from(out);
}

/** Writes the z-score of each of the first `n` values into `out`. */
export function zscoresInPlace(values: Float64Array, n: number, out: Float64Array): void {
  if (n === 0) return;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (values[i] - mean) ** 2;
  const sd = Math.sqrt(squares / n);
  if (sd === 0) {
    for (let i = 0; i < n; i++) out[i] = 0;
    return;
  }
  for (let i = 0; i < n; i++) out[i] = (values[i] - mean) / sd;
}

export function zscores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const out = new Float64Array(n);
  zscoresInPlace(Float64Array.from(values), n, out);
  return Array.from(out);
}

/** Maps a z-score onto a roughly 0-1 band for combining with percentile-based scores in the same units. */
export function zscoreToUnitScore(z: number): number {
  return 1 / (1 + Math.exp(-z)); // logistic squashing, keeps outliers from dominating after winsorization
}

/**
 * Weighted average of (score, weight) pairs, renormalizing over whichever
 * weights are actually present so a subset of missing/excluded entries
 * never gets treated as zero. Used both for year-weighting (35/25/20/10/10
 * across a metric's trailing fiscal years) and metric-weighting (a
 * category's metrics, equal by default or user-customized). Returns null
 * for an empty input or when every weight is non-positive.
 */
export function weightedAverage(entries: Array<{ score: number; weight: number }>): number | null {
  const weightSum = entries.reduce((acc, e) => acc + e.weight, 0);
  if (weightSum <= 0) return null;
  return entries.reduce((acc, e) => acc + (e.weight / weightSum) * e.score, 0);
}

/**
 * Allocation-free twin of weightedAverage over parallel arrays. Identical arithmetic in identical
 * order (accumulate the weights, then accumulate `(weight / weightSum) * score` left to right), so
 * it is bit-for-bit equal to weightedAverage on the same inputs — the aggregation loop runs this
 * ~500k times per recompute and cannot afford to build an object per metric-year.
 */
export function weightedAverageFrom(scores: ArrayLike<number>, weights: ArrayLike<number>, count: number): number | null {
  let weightSum = 0;
  for (let i = 0; i < count; i++) weightSum += weights[i];
  if (weightSum <= 0) return null;
  let acc = 0;
  for (let i = 0; i < count; i++) acc += (weights[i] / weightSum) * scores[i];
  return acc;
}
