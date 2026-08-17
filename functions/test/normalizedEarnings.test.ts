import { describe, expect, it } from "vitest";
// Imported from source rather than the @proverbs/shared entry point so the suite does not
// depend on shared/dist having been rebuilt since normalizedEarnings.ts was added — same
// convention as valuationHistory.test.ts.
import {
  computeNormalizedEarnings,
  MAX_NORMALIZED_WINDOW_YEARS,
  MIN_NORMALIZED_YEARS,
  NORMALIZED_EARNINGS_EXCLUDED_SECTORS,
  selectNormalizedWindow,
} from "../../shared/src/normalizedEarnings.js";
import { canonicalSector } from "../../shared/src/sectorApplicability.js";
import type { ValuationHistoryEntry } from "../../shared/src/valuationHistory.js";

function entry(fiscalYear: number, overrides: Partial<ValuationHistoryEntry> = {}): ValuationHistoryEntry {
  return {
    fiscalYear,
    floatAsOf: `${fiscalYear}-06-30`,
    publicFloat: 1000,
    netIncome: 100,
    revenue: 1000,
    totalEquity: 400,
    operatingIncome: 120,
    totalDebt: 200,
    cash: 100,
    sharesOutstanding: 50,
    source: "sec_edgar",
    ...overrides,
  };
}

/** `count` consecutive fiscal years ending at 2025, so the newest year is always FY2025. */
function series(count: number, fn: (index: number) => Partial<ValuationHistoryEntry> = () => ({})) {
  const first = 2025 - count + 1;
  return Array.from({ length: count }, (_, i) => entry(first + i, fn(i)));
}

describe("normalized earnings — window selection", () => {
  it("caps a 12-year history at the most recent 10 years", () => {
    const window = selectNormalizedWindow(series(12));
    expect(window.length).toBe(MAX_NORMALIZED_WINDOW_YEARS);
    expect(window[0].fiscalYear).toBe(2016);
    expect(window[window.length - 1].fiscalYear).toBe(2025);
  });

  it("uses all 10 years when exactly 10 are on file", () => {
    const report = computeNormalizedEarnings(series(10), { currentMarketCap: 1000 });
    expect(report.status).toBe("ok");
    expect(report.window?.years).toBe(10);
    expect(report.window?.label).toBe("10y average, FY2016–FY2025");
    // A full-length window carries no "shorter than 10 years" caveat.
    expect(report.caveats.some((c) => c.includes("not 10"))).toBe(false);
  });

  it("uses a 7-year window and says so in the label when only 7 years exist", () => {
    const report = computeNormalizedEarnings(series(7), { currentMarketCap: 1000 });
    expect(report.status).toBe("ok");
    expect(report.window?.label).toBe("7y average, FY2019–FY2025");
    expect(report.caveats.some((c) => c.includes("7 years, not 10"))).toBe(true);
  });

  it("returns null-with-reason at 5 years, below the 7-year minimum", () => {
    const report = computeNormalizedEarnings(series(5), { currentMarketCap: 1000 });
    expect(report.status).toBe("insufficient");
    expect(report.normalizedEarnings).toBeNull();
    expect(report.capeRatio).toBeNull();
    expect(report.earningsVsNormalized).toBeNull();
    expect(report.window).toBeNull();
    expect(report.reason).toContain("5 fiscal years");
    expect(report.reason).toContain(`at least ${MIN_NORMALIZED_YEARS}`);
  });

  it("returns null-with-reason at 2 years", () => {
    const report = computeNormalizedEarnings(series(2), { currentMarketCap: 1000 });
    expect(report.status).toBe("insufficient");
    expect(report.reason).toContain("2 fiscal years");
    // The refusal still exposes what it did find, so the panel can say how short the history is.
    expect(report.observations.length).toBe(2);
  });

  it("drops years with no net income rather than counting them as zero, and flags the gap", () => {
    const entries = series(10, (i) => (i === 4 ? { netIncome: null } : {}));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.window?.years).toBe(9);
    expect(report.window?.hasGaps).toBe(true);
    expect(report.normalizedEarnings).toBe(100);
    expect(report.caveats.some((c) => c.includes("not of consecutive years"))).toBe(true);
  });

  it("de-duplicates a repeated fiscal year instead of double-counting it", () => {
    const entries = [...series(8), entry(2025, { netIncome: 999 })];
    const window = selectNormalizedWindow(entries);
    expect(window.length).toBe(8);
    expect(window[window.length - 1].netIncome).toBe(999);
  });
});

describe("normalized earnings — hand-computed values", () => {
  // Ten years, net income 100,110,...,190. Sum = 1450, mean = 145.
  const RISING = series(10, (i) => ({ netIncome: 100 + i * 10 }));

  it("averages reported net income across the window", () => {
    const report = computeNormalizedEarnings(RISING, { currentMarketCap: 2900 });
    expect(report.normalizedEarnings).toBeCloseTo(145, 10);
    expect(report.latestEarnings).toBe(190);
    expect(report.latestFiscalYear).toBe(2025);
  });

  it("computes the CAPE-style multiple as market cap over the average, not over the latest year", () => {
    const report = computeNormalizedEarnings(RISING, { currentMarketCap: 2900 });
    // 2900 / 145 = 20.0 on mid-cycle earnings; the trailing P/E would be 2900/190 = 15.3.
    expect(report.capeRatio).toBeCloseTo(20, 10);
    expect(report.capeReason).toBeNull();
  });

  it("expresses the latest year as a multiple of the average", () => {
    const report = computeNormalizedEarnings(RISING, { currentMarketCap: 2900 });
    // 190 / 145
    expect(report.earningsVsNormalized).toBeCloseTo(1.310_344_827_586_2, 10);
  });

  it("averages the annual net margins, and reports the latest year's margin beside it", () => {
    // Revenue fixed at 1000, so the annual margins are 0.10 ... 0.19; mean 0.145.
    const report = computeNormalizedEarnings(RISING, { currentMarketCap: 2900 });
    expect(report.normalizedMargin).toBeCloseTo(0.145, 10);
    expect(report.normalizedMarginYears).toBe(10);
    expect(report.latestMargin).toBeCloseTo(0.19, 10);
    expect(report.marginReason).toBeNull();
  });

  it("averages ratios, not the ratio of the sums, so one huge-revenue year cannot dominate the margin", () => {
    // Margins: nine years at 0.10, one at 0.01. Mean of ratios = 0.091.
    // Ratio of sums would be 1900 / 100_000 = 0.019 — a different number, on purpose.
    const entries = series(10, (i) =>
      i === 9 ? { netIncome: 1000, revenue: 100_000 } : { netIncome: 100, revenue: 1000 },
    );
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.normalizedMargin).toBeCloseTo(0.091, 10);
    expect(report.latestMargin).toBeCloseTo(0.01, 10);
  });

  it("suppresses the mid-cycle margin when too few years report revenue, and keeps the earnings average", () => {
    const entries = series(10, (i) => (i < 6 ? { revenue: null } : {}));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.normalizedEarnings).toBe(100);
    expect(report.normalizedMargin).toBeNull();
    expect(report.normalizedMarginYears).toBe(4);
    expect(report.marginReason).toContain("only 4 of these 10 years");
  });
});

describe("normalized earnings — loss and zero years", () => {
  it("includes negative and zero years in the average rather than dropping them", () => {
    // 8 years: 100, 100, 100, 100, 0, -100, 100, 100 -> sum 500, mean 62.5.
    const values = [100, 100, 100, 100, 0, -100, 100, 100];
    const entries = series(8, (i) => ({ netIncome: values[i] }));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 625 });
    expect(report.normalizedEarnings).toBeCloseTo(62.5, 10);
    expect(report.capeRatio).toBeCloseTo(10, 10);
    expect(report.caveats.some((c) => c.includes("1 of the 8 years"))).toBe(true);
  });

  it("yields a null multiple with a reason when the window averages out to a loss", () => {
    // 7 years: six -100s and one +100 -> mean -85.71...
    const entries = series(7, (i) => ({ netIncome: i === 6 ? 100 : -100 }));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.status).toBe("ok");
    expect(report.normalizedEarnings).toBeLessThan(0);
    expect(report.capeRatio).toBeNull();
    expect(report.capeReason).toContain("average out to a loss");
    expect(report.earningsVsNormalized).toBeNull();
    expect(report.earningsVsNormalizedReason).toContain("not positive");
  });

  it("yields a null multiple when the window averages out to exactly zero", () => {
    const entries = series(8, (i) => ({ netIncome: i % 2 === 0 ? 100 : -100 }));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.normalizedEarnings).toBe(0);
    expect(report.capeRatio).toBeNull();
    expect(report.earningsVsNormalized).toBeNull();
  });

  it("suppresses the multiple but keeps the average when no market value is on file", () => {
    const report = computeNormalizedEarnings(series(10), { currentMarketCap: null });
    expect(report.normalizedEarnings).toBe(100);
    expect(report.capeRatio).toBeNull();
    expect(report.capeReason).toContain("no current market value");
    // The latest-vs-average read does not depend on price, so it survives.
    expect(report.earningsVsNormalized).toBe(1);
  });
});

describe("normalized earnings — the peak-earnings indicator on a constructed cyclical", () => {
  // A clean cycle: earnings 20, 60, 100, 140, 180, 140, 100, 60, 100, 200.
  // Sum = 1100, mean = 110. The last year, 200, is the cycle peak.
  const CYCLICAL_VALUES = [20, 60, 100, 140, 180, 140, 100, 60, 100, 200];
  const CYCLICAL = series(10, (i) => ({ netIncome: CYCLICAL_VALUES[i] }));

  it("flags a peak year as earning well above its own average", () => {
    const report = computeNormalizedEarnings(CYCLICAL, { currentMarketCap: 2200 });
    expect(report.normalizedEarnings).toBeCloseTo(110, 10);
    // 200 / 110 = 1.818...
    expect(report.earningsVsNormalized).toBeCloseTo(200 / 110, 10);
    expect(report.earningsVsNormalized).toBeGreaterThan(1.5);
  });

  it("shows the same company as materially dearer on mid-cycle earnings than on trailing earnings", () => {
    const marketCap = 2200;
    const report = computeNormalizedEarnings(CYCLICAL, { currentMarketCap: marketCap });
    const trailingPe = marketCap / CYCLICAL_VALUES[CYCLICAL_VALUES.length - 1]; // 11.0
    expect(trailingPe).toBeCloseTo(11, 10);
    expect(report.capeRatio).toBeCloseTo(20, 10); // 2200 / 110
    expect(report.capeRatio!).toBeGreaterThan(trailingPe);
  });

  it("reads below 1 at the trough of the same cycle, where the trailing multiple looks expensive", () => {
    // The same cycle ending one year earlier at its trough of 60.
    const troughValues = [200, 20, 60, 100, 140, 180, 140, 100, 60];
    const report = computeNormalizedEarnings(
      series(9, (i) => ({ netIncome: troughValues[i] })),
      { currentMarketCap: 1000 },
    );
    expect(report.normalizedEarnings).toBeCloseTo(1000 / 9, 10);
    expect(report.earningsVsNormalized!).toBeLessThan(1);
    // Trailing P/E of 16.7 against a CAPE-style 9.0 — the reverse of the peak case.
    expect(report.capeRatio!).toBeLessThan(1000 / 60);
  });
});

describe("normalized earnings — caveats", () => {
  it("flags a materially changed share count, since the figures are company totals", () => {
    const entries = series(10, (i) => ({ sharesOutstanding: 100 - i * 4 })); // 100 -> 64, -36%
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.caveats.some((c) => c.includes("share count fell about 36%"))).toBe(true);
  });

  it("does not flag a share count that barely moved", () => {
    const entries = series(10, (i) => ({ sharesOutstanding: 100 - i }));
    const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
    expect(report.caveats.some((c) => c.includes("share count"))).toBe(false);
  });

  it("discloses a public-float stand-in for market cap", () => {
    const report = computeNormalizedEarnings(series(10), {
      currentMarketCap: 1000,
      currentMarketCapIsPublicFloat: true,
    });
    expect(report.caveats.some((c) => c.includes("public float"))).toBe(true);
  });

  it("always carries the nominal-not-inflation-adjusted note, including when it refuses", () => {
    for (const entries of [series(10), series(3)]) {
      const report = computeNormalizedEarnings(entries, { currentMarketCap: 1000 });
      expect(report.basisNote).toContain("not adjusted for inflation");
      expect(report.basisNote).toContain("CPI");
    }
  });
});

describe("normalized earnings — sector applicability", () => {
  it("withholds the whole figure for Real Estate, under every sector wording the app sees", () => {
    for (const wording of ["Real Estate", "real estate", "REIT", "  REITs  "]) {
      const report = computeNormalizedEarnings(series(10), { currentMarketCap: 1000, sector: wording });
      expect(report.status, wording).toBe("not-applicable");
      expect(report.normalizedEarnings, wording).toBeNull();
      expect(report.capeRatio, wording).toBeNull();
      expect(report.reason, wording).toContain("depreciation");
    }
  });

  it("applies normally to Financials, under every sector wording the app sees", () => {
    for (const wording of ["Financials", "Financial Services", "financial services", "  FINANCIALS  "]) {
      const report = computeNormalizedEarnings(series(10), { currentMarketCap: 1000, sector: wording });
      expect(report.status, wording).toBe("ok");
      expect(report.capeRatio, wording).toBeCloseTo(10, 10);
    }
  });

  it("applies normally to an ordinary sector and to a company with no sector on record", () => {
    for (const sector of ["Technology", "Energy", null, undefined, ""]) {
      const report = computeNormalizedEarnings(series(10), { currentMarketCap: 1000, sector });
      expect(report.status, String(sector)).toBe("ok");
    }
  });

  it("excludes exactly one sector, and it canonicalizes to a sector the app recognizes", () => {
    // A typo here would silently disable the gate: canonicalSector() returns null for anything
    // unrecognized, and null never matches the exclusion list.
    expect(NORMALIZED_EARNINGS_EXCLUDED_SECTORS).toEqual(["Real Estate"]);
    for (const sector of NORMALIZED_EARNINGS_EXCLUDED_SECTORS) {
      expect(canonicalSector(sector)).toBe(sector);
    }
  });

  it("a not-applicable report still renders a reason rather than an empty panel", () => {
    const report = computeNormalizedEarnings(series(10), { currentMarketCap: 1000, sector: "Real Estate" });
    expect(report.reason).not.toBeNull();
    expect(report.reason!.length).toBeGreaterThan(20);
    // Neutral wording is a binding panel rule (FEATURE-RESEARCH.md §4): describe the accounting,
    // never judge the company.
    expect(report.reason!).not.toMatch(/\b(invalid|bad|poor|risky|fail|wrong|bogus|suspicious)\b/i);
  });
});
