import { describe, expect, it } from "vitest";
// Imported from source rather than the @proverbs/shared entry point so the suite does not
// depend on shared/dist having been rebuilt since valuationHistory.ts was added.
import {
  computeHistoricalMultiples,
  computeOwnHistoryValuation,
  detectDiscontinuities,
  percentileOfToday,
  resolveNormalization,
  summarizeDistribution,
  type FloatAnchor,
  type TodayFundamentals,
  type ValuationHistoryEntry,
} from "../../shared/src/valuationHistory.js";

function entry(fiscalYear: number, overrides: Partial<ValuationHistoryEntry> = {}): ValuationHistoryEntry {
  return {
    fiscalYear,
    floatAsOf: `${fiscalYear}-06-30`,
    publicFloat: 1000,
    netIncome: 100,
    revenue: 500,
    totalEquity: 400,
    operatingIncome: 120,
    totalDebt: 200,
    cash: 100,
    sharesOutstanding: 50,
    source: "sec_edgar",
    ...overrides,
  };
}

function years(count: number, fn: (index: number) => Partial<ValuationHistoryEntry>): ValuationHistoryEntry[] {
  return Array.from({ length: count }, (_, i) => entry(2016 + i, fn(i)));
}

const FUNDAMENTALS: TodayFundamentals = {
  fiscalYear: 2025,
  netIncome: 100,
  revenue: 500,
  totalEquity: 400,
  operatingIncome: 120,
  totalDebt: 200,
  cash: 100,
};

const ANCHOR: FloatAnchor = {
  fiscalYear: 2025,
  floatAsOf: "2025-06-30",
  marketCapAsOf: "2025-06-30",
  marketCap: 2000,
  publicFloat: 1900,
};

describe("computeHistoricalMultiples", () => {
  it("computes each multiple on the float basis", () => {
    const [row] = computeHistoricalMultiples([entry(2024)]);
    expect(row.floatPe).toBe(10);
    expect(row.floatPs).toBe(2);
    expect(row.floatPb).toBe(2.5);
    // (1000 + 200 - 100) / 120
    expect(row.floatEvEbit).toBeCloseTo(9.1667, 4);
  });

  it("omits multiples whose denominator is negative, zero or missing", () => {
    const [row] = computeHistoricalMultiples([
      entry(2024, { netIncome: -50, revenue: 0, totalEquity: null, operatingIncome: -10 }),
    ]);
    expect(row.floatPe).toBeNull();
    expect(row.floatPs).toBeNull();
    expect(row.floatPb).toBeNull();
    expect(row.floatEvEbit).toBeNull();
  });

  it("returns years in ascending order and drops entries with no usable float", () => {
    const rows = computeHistoricalMultiples([entry(2024), entry(2022, { publicFloat: 0 }), entry(2023)]);
    expect(rows.map((r) => r.fiscalYear)).toEqual([2023, 2024]);
  });
});

describe("summarizeDistribution", () => {
  it("interpolates quartiles the way a hand calculation does (n odd)", () => {
    const { summary } = summarizeDistribution([18, 10, 16, 12, 14]);
    expect(summary).toEqual({ median: 14, q1: 12, q3: 16, min: 10, max: 18, n: 5 });
  });

  it("interpolates between observations when the quantile falls between them", () => {
    const { summary } = summarizeDistribution([1, 2, 3, 4, 5, 6]);
    expect(summary?.q1).toBeCloseTo(2.25, 10);
    expect(summary?.median).toBeCloseTo(3.5, 10);
    expect(summary?.q3).toBeCloseTo(4.75, 10);
  });

  it("refuses to describe fewer than five usable years, with a reason", () => {
    const { summary, reason } = summarizeDistribution([10, 12, 14, 16]);
    expect(summary).toBeNull();
    expect(reason).toContain("4 fiscal years");
    expect(reason).toContain("at least 5");
  });

  it("counts only positive values towards the five-year minimum", () => {
    expect(summarizeDistribution([10, 12, 14, 16, -1, 0]).summary).toBeNull();
    expect(summarizeDistribution([10, 12, 14, 16, 18, -1]).summary?.n).toBe(5);
  });
});

describe("percentileOfToday", () => {
  const history = [10, 12, 14, 16, 18];

  it("places a value between the observations below and above it", () => {
    expect(percentileOfToday(11, history)).toBe(20);
    expect(percentileOfToday(17, history)).toBe(80);
  });

  it("uses the midpoint convention on an exact tie", () => {
    expect(percentileOfToday(14, history)).toBe(50);
  });

  it("pins the extremes", () => {
    expect(percentileOfToday(1, history)).toBe(0);
    expect(percentileOfToday(100, history)).toBe(100);
  });

  it("returns null rather than a placeholder when there is no comparable value", () => {
    expect(percentileOfToday(null, history)).toBeNull();
    expect(percentileOfToday(-5, history)).toBeNull();
    expect(percentileOfToday(14, [10, 12, 14, 16])).toBeNull();
  });
});

describe("detectDiscontinuities", () => {
  it("does not fire on ordinary compounding growth", () => {
    const entries = years(8, (i) => ({ revenue: 500 * 1.25 ** i, totalEquity: 400 * 1.25 ** i }));
    expect(detectDiscontinuities(entries)).toEqual([]);
  });

  it("flags the year a line more than doubles", () => {
    const entries = [entry(2022), entry(2023, { revenue: 1400 }), entry(2024, { revenue: 1450 })];
    const flags = detectDiscontinuities(entries);
    expect(flags).toHaveLength(1);
    expect(flags[0].fiscalYear).toBe(2023);
    expect(flags[0].drivers.map((d) => d.field)).toEqual(["revenue"]);
    expect(flags[0].note).toContain("FY2023");
    expect(flags[0].note).toContain("+180%");
    expect(flags[0].note).toContain("acquisition");
  });

  it("flags equity going negative even though no percentage describes it well", () => {
    const flags = detectDiscontinuities([entry(2022), entry(2023, { totalEquity: -50 })]);
    expect(flags).toHaveLength(1);
    expect(flags[0].drivers.map((d) => d.field)).toEqual(["totalEquity"]);
  });

  it("ignores non-consecutive fiscal years and missing lines", () => {
    expect(detectDiscontinuities([entry(2020), entry(2024, { revenue: 5000 })])).toEqual([]);
    expect(detectDiscontinuities([entry(2023, { revenue: null }), entry(2024, { revenue: 5000 })])).toEqual([]);
  });
});

describe("resolveNormalization", () => {
  it("measures the non-affiliate share of market cap on a date where both were observed", () => {
    const { normalization } = resolveNormalization([ANCHOR]);
    expect(normalization?.floatRatio).toBeCloseTo(0.95, 10);
    expect(normalization?.anchorFiscalYear).toBe(2025);
  });

  it("prefers the most recent usable anchor", () => {
    const older: FloatAnchor = { ...ANCHOR, fiscalYear: 2023, floatAsOf: "2023-06-30", marketCapAsOf: "2023-06-30" };
    expect(resolveNormalization([older, ANCHOR]).normalization?.anchorFiscalYear).toBe(2025);
  });

  it("rejects an anchor whose market cap was observed too far from the float date", () => {
    const drifted: FloatAnchor = { ...ANCHOR, marketCapAsOf: "2025-09-30" };
    const { normalization, reason } = resolveNormalization([drifted]);
    expect(normalization).toBeNull();
    expect(reason).toContain("cannot be put on the same basis");
  });

  it("rejects an implausible ratio", () => {
    expect(resolveNormalization([{ ...ANCHOR, publicFloat: 4000 }]).normalization).toBeNull();
    expect(resolveNormalization([{ ...ANCHOR, publicFloat: 10 }]).normalization).toBeNull();
  });
});

describe("computeOwnHistoryValuation", () => {
  // P/E of 10, 11, 12 ... 19 across FY2016–FY2025.
  const decade = years(10, (i) => ({ publicFloat: 1000 + i * 100 }));

  it("places today's observation once a normalization anchor exists", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
      anchors: [ANCHOR],
    });

    expect(report.status).toBe("ok");
    const pe = report.multiples.find((m) => m.key === "floatPe");
    // 2000 market cap x 0.95 float share = 1900 float-basis value, over 100 of net income.
    expect(pe?.todayFloatBasisValue).toBeCloseTo(19, 10);
    expect(pe?.todayMarketCapBasisValue).toBeCloseTo(20, 10);
    expect(pe?.todayPercentile).toBeCloseTo(95, 10);
    expect(pe?.summary).toEqual({ median: 14.5, q1: 12.25, q3: 16.75, min: 10, max: 19, n: 10 });
    expect(report.assumptions.window).toBe("FY2016–FY2025, 10 years");
    expect(report.assumptions.normalizationFactor).toBeCloseTo(0.95, 10);
    expect(report.assumptions.percentileResolution).toContain("10 points");
  });

  it("reports not-comparable, but still a distribution, when no anchor exists", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
    });

    expect(report.status).toBe("not-comparable");
    expect(report.reason).toContain("cannot be put on the same basis");
    for (const multiple of report.multiples) {
      expect(multiple.todayPercentile).toBeNull();
      expect(multiple.todayFloatBasisValue).toBeNull();
      expect(multiple.summary).not.toBeNull();
    }
    expect(report.assumptions.normalization).toContain("not placed on the band");
  });

  it("does not scale again when today's market cap is itself EDGAR's public float", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 1900,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
      todayMarketCapIsPublicFloat: true,
    });

    expect(report.status).toBe("ok");
    expect(report.multiples.find((m) => m.key === "floatPe")?.todayFloatBasisValue).toBeCloseTo(19, 10);
  });

  it("suppresses only the EV multiple for financials, and says why", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Financials",
      anchors: [ANCHOR],
    });

    const suppressed = report.multiples.filter((m) => m.suppressed);
    expect(suppressed.map((m) => m.key)).toEqual(["floatEvEbit"]);
    expect(suppressed[0].reason).toContain("Financials");
    expect(report.multiples.find((m) => m.key === "floatPb")?.summary).not.toBeNull();
    expect(report.multiples.find((m) => m.key === "floatPb")?.todayPercentile).not.toBeNull();
    expect(report.assumptions.suppressedMultiples.map((s) => s.key)).toEqual(["floatEvEbit"]);
  });

  it("keeps the EV multiple for every other sector", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Industrials",
      anchors: [ANCHOR],
    });
    expect(report.multiples.filter((m) => m.suppressed)).toEqual([]);
    expect(report.multiples.find((m) => m.key === "floatEvEbit")?.summary).not.toBeNull();
  });

  it("reports insufficient when no multiple reaches five usable years", () => {
    const report = computeOwnHistoryValuation({
      entries: years(4, (i) => ({ publicFloat: 1000 + i * 100 })),
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
      anchors: [ANCHOR],
    });

    expect(report.status).toBe("insufficient");
    expect(report.reason).toContain("4 fiscal years are on file");
    for (const multiple of report.multiples) {
      expect(multiple.summary).toBeNull();
      expect(multiple.todayPercentile).toBeNull();
    }
  });

  it("reports insufficient when loss-making years leave too few usable multiples", () => {
    const report = computeOwnHistoryValuation({
      entries: years(10, (i) => ({
        netIncome: i < 7 ? -50 : 100,
        revenue: null,
        totalEquity: null,
        operatingIncome: -10,
      })),
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
      anchors: [ANCHOR],
    });

    expect(report.status).toBe("insufficient");
    expect(report.reason).toContain("positive denominator");
    expect(report.multiples.find((m) => m.key === "floatPe")?.observations).toHaveLength(3);
  });

  it("reports not-comparable when the anchor exists but today's denominators do not", () => {
    const report = computeOwnHistoryValuation({
      entries: decade,
      todayMarketCap: 2000,
      todayFundamentals: { ...FUNDAMENTALS, netIncome: -20, revenue: null, totalEquity: null, operatingIncome: 0 },
      sector: "Technology",
      anchors: [ANCHOR],
    });

    expect(report.status).toBe("not-comparable");
    expect(report.reason).toContain("today's fundamentals");
    expect(report.multiples.every((m) => m.summary !== null)).toBe(true);
  });

  it("carries discontinuity flags into the report", () => {
    const entries = decade.map((e) => (e.fiscalYear === 2021 ? { ...e, revenue: 1500 } : e));
    const report = computeOwnHistoryValuation({
      entries,
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
      anchors: [ANCHOR],
    });
    expect(report.discontinuities.map((d) => d.fiscalYear)).toEqual([2021, 2022]);
  });

  it("says nothing has been ingested when there are no entries at all", () => {
    const report = computeOwnHistoryValuation({
      entries: [],
      todayMarketCap: 2000,
      todayFundamentals: FUNDAMENTALS,
      sector: "Technology",
    });
    expect(report.status).toBe("insufficient");
    expect(report.reason).toContain("no public-float history");
    expect(report.assumptions.window).toBeNull();
  });
});
