import { describe, expect, it } from "vitest";
import type { PriceHistoryPoint } from "@proverbs/shared";
import { withMovingAverages } from "./PriceHistoryChart";

function series(days: number, priceAt: (dayIndex: number) => number): PriceHistoryPoint[] {
  const points: PriceHistoryPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date("2024-01-01");
    d.setUTCDate(d.getUTCDate() + i);
    points.push({ date: d.toISOString().slice(0, 10), close: priceAt(i) });
  }
  return points;
}

describe("withMovingAverages", () => {
  it("returns null for ma50 until 50 days of history exist", () => {
    const points = series(60, (i) => 100 + i);
    const result = withMovingAverages(points);
    expect(result[48].ma50).toBeNull(); // only 49 points so far (idx 0..48)
    expect(result[49].ma50).not.toBeNull(); // exactly 50 points (idx 0..49)
  });

  it("returns null for ma200 when the series is shorter than 200 days", () => {
    const points = series(60, (i) => 100 + i);
    const result = withMovingAverages(points);
    expect(result.every((p) => p.ma200 === null)).toBe(true);
  });

  it("computes a simple average of the trailing window, ending at that point", () => {
    // Constant 100 for the first 49 days, then 200 on day index 49 (the 50th day) — the 50-day
    // average ending exactly there should be (49*100 + 200)/50.
    const points = series(50, (i) => (i === 49 ? 200 : 100));
    const result = withMovingAverages(points);
    expect(result[49].ma50).toBeCloseTo((49 * 100 + 200) / 50, 5);
  });

  it("is a trailing (not centered) average — a later spike doesn't affect an earlier point's MA", () => {
    const points = series(60, (i) => (i === 55 ? 10000 : 100));
    const result = withMovingAverages(points);
    expect(result[49].ma50).toBeCloseTo(100, 5); // window is days 0..49, spike is at day 55
  });

  it("sorts input by date before computing, independent of input order", () => {
    const sorted = series(60, (i) => 100 + i);
    const shuffled = [...sorted].reverse();
    expect(withMovingAverages(shuffled)).toEqual(withMovingAverages(sorted));
  });
});
