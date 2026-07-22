export function winsorize(values: number[], lowerPct: number, upperPct: number): number[] {
  if (values.length < 2) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const lowerBound = sorted[Math.floor(lowerPct * (sorted.length - 1))];
  const upperBound = sorted[Math.ceil(upperPct * (sorted.length - 1))];
  return values.map((v) => Math.min(Math.max(v, lowerBound), upperBound));
}

/** Percentile rank (0-1) of each value within the peer set, order-preserved with input. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const order = values.map((_, idx) => idx).sort((a, b) => values[a] - values[b]);
  const out = new Array<number>(n);
  order.forEach((originalIndex, rank) => {
    out[originalIndex] = rank / (n - 1);
  });
  return out;
}

export function zscores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/** Maps a z-score onto a roughly 0-1 band for combining with percentile-based scores in the same units. */
export function zscoreToUnitScore(z: number): number {
  return 1 / (1 + Math.exp(-z)); // logistic squashing, keeps outliers from dominating after winsorization
}
