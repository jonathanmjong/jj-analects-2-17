import { describe, expect, it } from "vitest";
import {
  COMPANY_TABS,
  COMPANY_TAB_IDS,
  DEFAULT_COMPANY_TAB,
  companyTabEmptyReason,
  type CompanyTabDataPresence,
} from "./companyTabs";

const FULL: CompanyTabDataPresence = {
  ticker: "AAPL",
  hasStatements: true,
  hasMetricScores: true,
  hasSentiment: true,
};

const EMPTY: CompanyTabDataPresence = {
  ticker: "AAPL",
  hasStatements: false,
  hasMetricScores: false,
  hasSentiment: false,
};

describe("company tab definitions", () => {
  it("defines exactly one entry per tab id, in the declared order", () => {
    expect(COMPANY_TABS.map((tab) => tab.id)).toEqual([...COMPANY_TAB_IDS]);
  });

  it("opens on a tab that exists", () => {
    expect(COMPANY_TAB_IDS).toContain(DEFAULT_COMPANY_TAB);
  });

  it("gives every tab a label and a one-line statement of what it answers", () => {
    for (const tab of COMPANY_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("companyTabEmptyReason", () => {
  it("reports nothing empty when every kind of data is present", () => {
    for (const id of COMPANY_TAB_IDS) {
      expect(companyTabEmptyReason(id, FULL)).toBeNull();
    }
  });

  it("names the company and the missing data for each raw-data tab", () => {
    expect(companyTabEmptyReason("financials", EMPTY)).toBe(
      "No annual financial statements have been ingested for AAPL yet.",
    );
    expect(companyTabEmptyReason("metrics", EMPTY)).toBe("No metric scores have been computed for AAPL yet.");
    expect(companyTabEmptyReason("sentiment", EMPTY)).toBe("No news sentiment has been collected for AAPL yet.");
  });

  it("leaves the analysis tabs to their own panels, which state their own reasons", () => {
    expect(companyTabEmptyReason("overview", EMPTY)).toBeNull();
    expect(companyTabEmptyReason("valuation", EMPTY)).toBeNull();
    expect(companyTabEmptyReason("quality", EMPTY)).toBeNull();
  });

  it("keys each reason off only its own data, not the others", () => {
    expect(companyTabEmptyReason("financials", { ...EMPTY, hasStatements: true })).toBeNull();
    expect(companyTabEmptyReason("metrics", { ...EMPTY, hasMetricScores: true })).toBeNull();
    expect(companyTabEmptyReason("sentiment", { ...EMPTY, hasSentiment: true })).toBeNull();
  });
});
