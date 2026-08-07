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

  it("smooths a single anomalous spike landing on the 12-month boundary instead of using it raw", () => {
    // Flat $100 series for 400 days, except one day near the 12-months-ago boundary that spikes
    // to $10,000 (a bad print / stale-data glitch). A single-day lookup at that exact date would
    // read the return as roughly -99% (100 vs. 10,000); a 5-day-average lookup should barely
    // register the spike since it's diluted across the averaging window.
    const spikeIndex = 400 - 365; // lands within the 12-months-ago window from the series end
    const points = series("2024-01-01", 400, (i) => (i === spikeIndex ? 10000 : 100));
    const result = computeMomentumFromSeries(points);
    expect(result).not.toBeNull();
    expect(result!.return12m1m).not.toBeNull();
    // With smoothing, at most 1 of the 5 averaged days is the $10,000 spike, so the smoothed
    // 12-months-ago price is at most (4*100 + 10000)/5 = 2080 — a raw single-day lookup that
    // happened to land exactly on the spike would instead read ~10000, producing a return near
    // -99%. Assert we're nowhere near that.
    expect(Math.abs(result!.return12m1m!)).toBeLessThan(0.96);
  });

  it("risk-adjusted return's last-day close is smoothed too, not read raw", () => {
    // A gentle daily wiggle (so volatility is well-defined and non-zero) around $100, identical
    // in both series except the very last (most recent) day, which is either a one-off $50 dip
    // (glitch case) or the normal wiggle value (baseline). A single-day-close read at the
    // window's end would see a huge swing purely from that one day; averaged over the trailing 5
    // days it's diluted roughly 5x.
    const wiggle = (i: number) => 100 + (i % 2 === 0 ? 0.5 : -0.5);
    const baseline = series("2024-01-01", 200, wiggle);
    const withGlitch = series("2024-01-01", 200, wiggle);
    withGlitch[withGlitch.length - 1] = { ...withGlitch[withGlitch.length - 1], close: 50 };

    const baselineResult = computeMomentumFromSeries(baseline);
    const glitchResult = computeMomentumFromSeries(withGlitch);
    expect(baselineResult!.riskAdjusted3m).not.toBeNull();
    expect(glitchResult!.riskAdjusted3m).not.toBeNull();
    // A raw single-day read would make cumulative return swing by ~50 percentage points; smoothed
    // over 5 days it's diluted roughly 5x, so the two results should stay much closer than that.
    expect(Math.abs(glitchResult!.riskAdjusted3m! - baselineResult!.riskAdjusted3m!)).toBeLessThan(5);
  });
});
