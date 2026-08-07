import type { MomentumSnapshot, PriceHistoryPoint } from "@proverbs/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_POINTS_FOR_RISK_ADJUSTED = 15; // roughly 3 trading weeks; below this, volatility is too noisy to trust
/** Trading days averaged at each measurement boundary — smooths out a single anomalous or stale
 * data point landing exactly on the boundary distorting an entire momentum reading. Comfortably
 * below MIN_POINTS_FOR_RISK_ADJUSTED so the two edges of a risk-adjusted window never overlap. */
const SMOOTHING_WINDOW_DAYS = 5;

function monthsAgo(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function average(points: PriceHistoryPoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((sum, p) => sum + p.close, 0) / points.length;
}

/**
 * Average close over the trailing `windowDays` trading days on or before `target`, not a single
 * day's raw close — one volatile or erroneous print landing exactly on a measurement boundary
 * (e.g. "12 months ago") shouldn't swing the whole momentum reading. Falls back to the earliest
 * point(s) available if the series doesn't reach back that far, same as a plain nearest-point
 * lookup would.
 */
function smoothedCloseAsOf(points: PriceHistoryPoint[], target: Date, windowDays = SMOOTHING_WINDOW_DAYS): number | null {
  if (points.length === 0) return null;
  const targetMs = target.getTime();
  const upToTarget = points.filter((p) => new Date(p.date).getTime() <= targetMs);
  const window = (upToTarget.length > 0 ? upToTarget : points.slice(0, 1)).slice(-windowDays);
  return average(window);
}

function simpleReturns(points: PriceHistoryPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    const curr = points[i].close;
    if (prev > 0) returns.push(curr / prev - 1);
  }
  return returns;
}

function stddevSample(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function riskAdjustedReturn(points: PriceHistoryPoint[], windowStart: Date): number | null {
  const window = points.filter((p) => new Date(p.date).getTime() >= windowStart.getTime());
  if (window.length < MIN_POINTS_FOR_RISK_ADJUSTED) return null;
  const first = average(window.slice(0, SMOOTHING_WINDOW_DAYS));
  const last = average(window.slice(-SMOOTHING_WINDOW_DAYS));
  if (first === null || last === null || first <= 0) return null;
  const cumulativeReturn = last / first - 1;
  const volatility = stddevSample(simpleReturns(window));
  if (volatility === null || volatility === 0) return null;
  return cumulativeReturn / volatility;
}

/**
 * Derives momentum figures from a trailing daily-ish price series (ascending
 * or descending order both fine — sorted internally). Returns nulls for any
 * figure the series doesn't have enough history to support, rather than
 * guessing — a company with 2 months of price history shouldn't get a
 * fabricated 12-1 month return.
 */
export function computeMomentumFromSeries(rawPoints: PriceHistoryPoint[]): MomentumSnapshot | null {
  if (rawPoints.length === 0) return null;
  const points = [...rawPoints].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = points[points.length - 1];
  const latestDate = new Date(latest.date);

  const price1moAgo = smoothedCloseAsOf(points, monthsAgo(latestDate, 1));
  const price12moAgo = smoothedCloseAsOf(points, monthsAgo(latestDate, 12));
  // Require the series to actually span ~12 months (with slack for weekends/holidays around the
  // boundary) — otherwise price12moAgo silently falls back to the earliest point and produces a
  // return over a much shorter, misleadingly-labeled window.
  const spansYear = latestDate.getTime() - new Date(points[0].date).getTime() >= 335 * DAY_MS;
  const return12m1m =
    spansYear && price1moAgo !== null && price12moAgo !== null && price12moAgo > 0 ? price1moAgo / price12moAgo - 1 : null;

  return {
    return12m1m,
    riskAdjusted3m: riskAdjustedReturn(points, monthsAgo(latestDate, 3)),
    riskAdjusted6m: riskAdjustedReturn(points, monthsAgo(latestDate, 6)),
    asOf: latest.date,
  };
}
