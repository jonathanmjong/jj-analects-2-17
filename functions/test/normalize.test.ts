import { describe, expect, it } from "vitest";
import { percentileRanks, winsorize, zscores } from "../src/ranking/normalize.js";

describe("winsorize", () => {
  it("clamps extreme values to the configured percentile bounds", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const result = winsorize(values, 0.1, 0.8);
    expect(Math.max(...result)).toBeLessThan(1000);
    expect(result.length).toBe(values.length);
  });

  it("is a no-op for fewer than 2 values", () => {
    expect(winsorize([5], 0.1, 0.9)).toEqual([5]);
  });
});

describe("percentileRanks", () => {
  it("assigns 0 to the minimum and 1 to the maximum", () => {
    const ranks = percentileRanks([10, 20, 30]);
    expect(ranks[0]).toBe(0);
    expect(ranks[2]).toBe(1);
  });

  it("handles a single value as the 100th percentile", () => {
    expect(percentileRanks([42])).toEqual([1]);
  });

  it("preserves input order", () => {
    const ranks = percentileRanks([30, 10, 20]);
    expect(ranks[1]).toBe(0); // 10 is the minimum, at original index 1
    expect(ranks[0]).toBe(1); // 30 is the maximum, at original index 0
  });
});

describe("zscores", () => {
  it("centers values around zero", () => {
    const z = zscores([2, 4, 6]);
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    expect(mean).toBeCloseTo(0, 5);
  });

  it("returns all zeros when standard deviation is zero", () => {
    expect(zscores([5, 5, 5])).toEqual([0, 0, 0]);
  });
});
