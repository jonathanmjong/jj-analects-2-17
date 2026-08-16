import { describe, expect, it } from "vitest";
import { inapplicabilityReason, isMetricApplicable, SECTOR_INAPPLICABLE_METRICS } from "@proverbs/shared";
import { METRIC_DEFINITIONS } from "../src/metrics/definitions.js";

const FINANCIALS_INAPPLICABLE = [
  "ev_ebit",
  "ev_ebitda",
  "ev_fcf",
  "earnings_yield",
  "fcf_yield",
  "fcf_margin",
  "fcf_to_revenue",
  "fcf_to_net_income",
  "cash_conversion_ratio",
  "ocf_margin",
  "capex_to_revenue",
  "roic",
  "avg_roic_5y",
  "current_ratio",
  "quick_ratio",
  "debt_to_equity",
  "debt_to_ebitda",
  "interest_coverage",
  "debt_maturity_mix",
  "net_cash_to_market_cap",
  "cash_to_market_cap",
  "asset_turnover",
  "inventory_turnover",
  "receivable_turnover",
  "cash_conversion_cycle",
  "gross_profitability",
  "net_operating_assets",
];

// Metrics that must survive the gate: without these a bank has almost nothing left to be scored
// on, which would trade one distortion (scoring banks on meaningless numbers) for another
// (scoring them on nothing).
const FINANCIALS_APPLICABLE = [
  "pe_ttm",
  "pb",
  "price_tangible_book",
  "ps",
  "shareholder_yield_valuation",
  "roe",
  "roa",
  "net_margin",
  "operating_margin",
  "dividend_yield",
  "dividend_cagr_3y",
  "buyback_yield",
  "share_count_change",
  "piotroski_f_score",
  "accrual_ratio",
  "revenue_volatility",
  "eps_volatility",
  "growth_revenue_1y",
  "growth_bookValue_5y",
  // A bank's total assets ARE its loan book, so year-over-year growth in them is a real,
  // readable fact about how fast it is lending — unlike gross profitability and net operating
  // assets, nothing about the accounting makes the number meaningless here.
  "asset_growth",
];

const REAL_ESTATE_INAPPLICABLE = ["pe_ttm", "inventory_turnover", "receivable_turnover", "cash_conversion_cycle"];

// Deliberately kept applicable for REITs: unlike banks, a property portfolio has a real capital
// structure and real interest expense, so these are standard ways to look at one — arguable at
// worst, not meaningless.
const REAL_ESTATE_APPLICABLE = [
  "ev_ebit",
  "ev_ebitda",
  "ev_fcf",
  "debt_to_ebitda",
  "interest_coverage",
  "roic",
  "pb",
  "ps",
  // Rental revenue less property operating costs, over a portfolio carried at depreciated cost,
  // is a real quantity; so is portfolio expansion; and a REIT's properties really are operating
  // assets funded by equity and debt. Depreciated historical cost makes all three arguable for a
  // property company — which is the bar for staying applicable, not for being excluded.
  "gross_profitability",
  "asset_growth",
  "net_operating_assets",
];

describe("sectorApplicability — Financials", () => {
  it.each(FINANCIALS_INAPPLICABLE)("marks %s inapplicable", (key) => {
    expect(isMetricApplicable(key, "Financials")).toBe(false);
  });

  it.each(FINANCIALS_APPLICABLE)("keeps %s applicable", (key) => {
    expect(isMetricApplicable(key, "Financials")).toBe(true);
  });
});

describe("sectorApplicability — Real Estate", () => {
  it.each(REAL_ESTATE_INAPPLICABLE)("marks %s inapplicable", (key) => {
    expect(isMetricApplicable(key, "Real Estate")).toBe(false);
  });

  it.each(REAL_ESTATE_APPLICABLE)("keeps %s applicable", (key) => {
    expect(isMetricApplicable(key, "Real Estate")).toBe(true);
  });

  it("gates P/E on depreciation, and says so", () => {
    expect(inapplicabilityReason("pe_ttm", "Real Estate")).toMatch(/depreciation/i);
    expect(inapplicabilityReason("pe_ttm", "Real Estate")).toMatch(/FFO/);
  });
});

describe("sectorApplicability — unknown and missing sectors", () => {
  it.each([null, "", "Technology", "Industrials", "Healthcare", "Energy", "Utilities", "Materials"])(
    "treats every metric as applicable for sector %s",
    (sector) => {
      for (const key of [...FINANCIALS_INAPPLICABLE, ...REAL_ESTATE_INAPPLICABLE]) {
        expect(isMetricApplicable(key, sector)).toBe(true);
        expect(inapplicabilityReason(key, sector)).toBeNull();
      }
    },
  );

  it("matches provider sector wordings that differ between SEC EDGAR and Yahoo", () => {
    // sicSectorMap emits "Financials"; Yahoo's company profile emits "Financial Services".
    for (const wording of ["Financials", "Financial Services", "financial services", "  FINANCIALS  "]) {
      expect(isMetricApplicable("roic", wording)).toBe(false);
    }
    for (const wording of ["Real Estate", "real estate", "REIT"]) {
      expect(isMetricApplicable("pe_ttm", wording)).toBe(false);
    }
  });
});

describe("sectorApplicability — the map itself", () => {
  it("only lists metric keys that exist in the registry", () => {
    const known = new Set(METRIC_DEFINITIONS.map((m) => m.key));
    for (const [sector, groups] of Object.entries(SECTOR_INAPPLICABLE_METRICS)) {
      for (const group of groups) {
        for (const key of group.metricKeys) {
          expect(known.has(key), `${sector}: unknown metric key "${key}"`).toBe(true);
        }
      }
    }
  });

  it("lists no metric key twice within a sector", () => {
    for (const [sector, groups] of Object.entries(SECTOR_INAPPLICABLE_METRICS)) {
      const keys = groups.flatMap((g) => g.metricKeys);
      expect(new Set(keys).size, `${sector} has a duplicated metric key`).toBe(keys.length);
    }
  });

  it("gives every listed metric a reason that explains the accounting without judging the company", () => {
    for (const [sector, groups] of Object.entries(SECTOR_INAPPLICABLE_METRICS)) {
      for (const group of groups) {
        expect(group.reason.length).toBeGreaterThan(20);
        // Neutral, descriptive wording is a binding design requirement from the review panel
        // (FEATURE-RESEARCH.md §4): describe why the number doesn't fit, never imply the
        // company is bad, broken, or hiding something.
        expect(group.reason).not.toMatch(/\b(invalid|bad|poor|risky|fail|wrong|bogus|suspicious)\b/i);
        for (const key of group.metricKeys) {
          expect(inapplicabilityReason(key, sector)).toBe(group.reason);
        }
      }
    }
  });

  it("leaves the great majority of the registry applicable to both gated sectors", () => {
    // A sanity bound on scope creep: this layer exists to remove meaningless metrics, not to
    // stop scoring financials and REITs.
    for (const sector of ["Financials", "Real Estate"]) {
      const applicable = METRIC_DEFINITIONS.filter((m) => isMetricApplicable(m.key, sector)).length;
      expect(applicable / METRIC_DEFINITIONS.length).toBeGreaterThan(0.5);
    }
  });
});
