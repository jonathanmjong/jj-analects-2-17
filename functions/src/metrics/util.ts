export function safeDiv(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

/** Annualized growth rate between `end` (recent) and `start` (N years ago). Null if either is missing or start <= 0. */
export function cagr(end: number | null, start: number | null, years: number): number | null {
  if (end === null || start === null || start <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function stddev(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length < 2) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const variance = present.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (present.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation — used for margin/revenue/EPS "stability" and "volatility" metrics. */
export function coefficientOfVariation(values: Array<number | null | undefined>): number | null {
  const mean = average(values);
  const sd = stddev(values);
  if (mean === null || sd === null || mean === 0) return null;
  return sd / Math.abs(mean);
}
