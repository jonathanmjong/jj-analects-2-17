import { describe, expect, it } from "vitest";
import { formatCurrency, formatPercent, formatMultiple } from "./utils";

describe("formatCurrency", () => {
  it("formats a plain USD amount", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });

  it("compacts large values", () => {
    expect(formatCurrency(2_500_000_000, { compact: true })).toBe("$2.5B");
  });

  it("returns an em dash for null", () => {
    expect(formatCurrency(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("converts a fraction to a percentage string", () => {
    expect(formatPercent(0.1523, 1)).toBe("15.2%");
  });
});

describe("formatMultiple", () => {
  it("appends an x suffix", () => {
    expect(formatMultiple(12.345, 1)).toBe("12.3x");
  });
});
