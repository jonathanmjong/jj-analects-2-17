import { describe, expect, it } from "vitest";
import { computeMomentumFromSeries } from "../src/ingestion/computeMomentum.js";
import type { PriceHistoryPoint } from "@proverbs/shared";

/** Daily points from `startDate` for `days` calendar days, price following `priceAt(dayIndex)`. */
function series(startDate: string, days: number, priceAt: (dayIndex: number) => number): PriceHistoryPoint[] {
  const start = new Date(startDate);
  const points: PriceHistoryPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    points.push({ date: d.toISOString().slice(0, 10), close: priceAt(i) });
  }
  return points;
}

describe("computeMomentumFromSeries", () => {
  it("returns null for an empty series", () => {
    expect(computeMomentumFromSeries([])).toBeNull();
  });

  it("computes 12-1 month return from a series spanning just over a year", () => {
    // Steady linear climb from 100 to 465 over 400 days (roughly +1/day).
    const points = series("2024-01-01", 400, (i) => 100 + i);
    const result = computeMomentumFromSeries(points);
    expect(result).not.toBeNull();
    expect(result!.return12m1m).not.toBeNull();
    // Price ~1 month before the end vs. ~12 months before the end — both well within the
    // climbing series, so the return should be positive and a reasonable double-digit-percent size.
    expect(result!.return12m1m!).toBeGreaterThan(0);
  });

  it("returns null 12-1 momentum when the series doesn't span a full year", () => {
    const points = series("2024-01-01", 60, (i) => 100 + i);
    const result = computeMomentumFromSeries(points);
    expect(result).not.toBeNull();
    expect(result!.return12m1m).toBeNull();
  });

  it("computes a positive risk-adjusted return for a steadily rising series", () => {
    const points = series("2024-01-01", 200, (i) => 100 * (1 + i * 0.002));
    const result = computeMomentumFromSeries(points);
    expect(result).not.toBeNull();
    expect(result!.riskAdjusted3m).not.toBeNull();
    expect(result!.riskAdjusted3m!).toBeGreaterThan(0);
    expect(result!.riskAdjusted6m).not.toBeNull();
    expect(result!.riskAdjusted6m!).toBeGreaterThan(0);
  });

  it("computes a negative risk-adjusted return for a steadily falling series", () => {
    const points = series("2024-01-01", 200, (i) => 100 * (1 - i * 0.002));
    const result = computeMomentumFromSeries(points);
    expect(result!.riskAdjusted3m!).toBeLessThan(0);
  });

  it("returns null risk-adjusted figures when the window has too few points", () => {
    const points = series("2024-01-01", 5, (i) => 100 + i);
    const result = computeMomentumFromSeries(points);
    expect(result).not.toBeNull();
    expect(result!.riskAdjusted3m).toBeNull();
    expect(result!.riskAdjusted6m).toBeNull();
  });

  it("is order-independent — an unsorted input series gives the same result as sorted", () => {
    const sorted = series("2024-01-01", 200, (i) => 100 + i * 0.5);
    const shuffled = [...sorted].reverse();
    expect(computeMomentumFromSeries(shuffled)).toEqual(computeMomentumFromSeries(sorted));
  });

  it("sets asOf to the most recent point's date", () => {
    const points = series("2024-01-01", 30, (i) => 100 + i);
    const result = computeMomentumFromSeries(points);
    expect(result!.asOf).toBe(points[points.length - 1].date);
  });
});
