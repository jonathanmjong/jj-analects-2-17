import { describe, expect, it } from "vitest";
import { getMetricRationale, inapplicabilityReason, isMetricApplicable, VERDICT_DEFAULT_WEIGHT } from "@proverbs/shared";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import { parseAnnualCashFlowStatements, SHARE_BASED_COMPENSATION_TAGS } from "../src/providers/SecEdgarProvider.js";
import { sbcToFcf, sbcToRevenue } from "../src/metrics/calculators/earningsQuality.js";
import { METRIC_DEFINITIONS } from "../src/metrics/definitions.js";
import type { MetricInput, PeriodFinancials } from "../src/metrics/types.js";

/**
 * Share-based compensation: ingestion (tag precedence) plus the two metrics built on it.
 *
 * The panel gap this closes is "share-count and share-based-comp honesty" — the registry already
 * measured dilution (`share_count_change`) but nothing measured what that dilution COST.
 *
 * The ingestion half is the delicate part. `ShareBasedCompensation` and
 * `AllocatedShareBasedCompensationExpense` are NOT synonyms, and every tag inside one filing
 * carries the same `filed` date, so a plain `annualSeries` merge would resolve a collision by
 * array iteration order — the mistake documented on annualFactsByEndWithFallback. Verified live
 * on EDGAR 2026-08: across a 10-filer sample, 31 of 115 overlapping annual periods disagreed and
 * 20 disagreed by more than 2% (GOOGL FY2025 $24.953B vs $27.1B, +8.6%; JNJ FY2023 $1.138B vs
 * $1.028B, -9.7%; IBM FY2020 $937M vs $873M, -6.8%), all with identical `filed` dates. The
 * fallback still earns its slot: MSFT has 12 annual periods under the primary against 19 under
 * the fallback, and WMT has ZERO under the primary against 16 under the fallback. XOM has neither
 * tag in any year, so it must stay null — never zero.
 */

const FILED = "2026-02-20";

function durationFact(end: string, val: number, filed = FILED): XbrlFact {
  const start = new Date(new Date(end).getTime() - 364 * 86_400_000).toISOString().slice(0, 10);
  return { start, end, val, fy: new Date(end).getUTCFullYear(), fp: "FY", form: "10-K", filed };
}

function companyFacts(tags: Record<string, XbrlFact[]>): CompanyFacts {
  return {
    facts: {
      "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, facts]) => [tag, { units: { USD: facts } }])),
    },
  };
}

/** Operating cash flow is what selects the fiscal years, so every case needs one. */
const ocf = (...ends: string[]) => ({
  NetCashProvidedByUsedInOperatingActivities: ends.map((end, i) => durationFact(end, 2_000_000_000 + i)),
});

const sbcFor = (facts: CompanyFacts) => parseAnnualCashFlowStatements(facts, 6, "sec_edgar")[0].shareBasedCompensation;

describe("SEC EDGAR — share-based compensation tag precedence", () => {
  it("documents its precedence in one place, primary first", () => {
    expect(SHARE_BASED_COMPENSATION_TAGS).toEqual([
      "ShareBasedCompensation",
      "AllocatedShareBasedCompensationExpense",
    ]);
  });

  it("takes the cash-flow add-back over a note-level figure filed on the SAME date (the GOOGL case)", () => {
    // The regression this whole strict-precedence path exists for: identical `filed`, so the
    // dedupe-on-freshest-filing rule cannot separate them and only tag order can.
    expect(
      sbcFor(
        companyFacts({
          ...ocf("2025-12-31"),
          ShareBasedCompensation: [durationFact("2025-12-31", 24_953_000_000)],
          AllocatedShareBasedCompensationExpense: [durationFact("2025-12-31", 27_100_000_000)],
        }),
      ),
    ).toBe(24_953_000_000);
  });

  it("is not sensitive to which tag appears first in the response object", () => {
    expect(
      sbcFor(
        companyFacts({
          ...ocf("2025-12-31"),
          AllocatedShareBasedCompensationExpense: [durationFact("2025-12-31", 27_100_000_000)],
          ShareBasedCompensation: [durationFact("2025-12-31", 24_953_000_000)],
        }),
      ),
    ).toBe(24_953_000_000);
  });

  it("does NOT let a later-filed fallback displace the primary (the difference from the D&A merge)", () => {
    // DEPRECIATION_AND_AMORTIZATION_TAGS is a plain merge, where a later filing of either tag
    // wins. This field must not behave that way: the two tags are different figures, so a
    // fallback restatement must never silently move a company onto the note-level basis.
    expect(
      sbcFor(
        companyFacts({
          ...ocf("2025-12-31"),
          ShareBasedCompensation: [durationFact("2025-12-31", 24_953_000_000, "2026-02-05")],
          AllocatedShareBasedCompensationExpense: [durationFact("2025-12-31", 27_100_000_000, "2026-09-01")],
        }),
      ),
    ).toBe(24_953_000_000);
  });

  it("still prefers the freshest filing WITHIN the primary tag", () => {
    expect(
      sbcFor(
        companyFacts({
          ...ocf("2025-12-31"),
          ShareBasedCompensation: [
            durationFact("2025-12-31", 24_000_000_000, "2026-02-05"),
            durationFact("2025-12-31", 24_953_000_000, "2026-08-01"),
          ],
        }),
      ),
    ).toBe(24_953_000_000);
  });

  it("resolves each fiscal period independently across a mixed history (the MSFT case)", () => {
    // Microsoft tags the primary only from FY2015 onwards but the fallback all the way back to
    // FY2008. Per-period resolution keeps the recent years on the cash-flow basis while still
    // filling the older ones, instead of restating the whole history onto one tag.
    const statements = parseAnnualCashFlowStatements(
      companyFacts({
        ...ocf("2022-06-30", "2023-06-30", "2024-06-30", "2025-06-30"),
        ShareBasedCompensation: [
          durationFact("2024-06-30", 10_734_000_000),
          durationFact("2025-06-30", 11_974_000_000),
        ],
        AllocatedShareBasedCompensationExpense: [
          durationFact("2022-06-30", 7_502_000_000),
          durationFact("2023-06-30", 9_611_000_000),
          // Deliberately disagreeing with the primary in the years the primary covers.
          durationFact("2024-06-30", 10_000_000_000),
          durationFact("2025-06-30", 11_000_000_000),
        ],
      }),
      6,
      "sec_edgar",
    );

    expect(statements.map((s) => [s.fiscalYear, s.shareBasedCompensation])).toEqual([
      [2025, 11_974_000_000],
      [2024, 10_734_000_000],
      [2023, 9_611_000_000],
      [2022, 7_502_000_000],
    ]);
  });

  it("uses the fallback alone when a filer never tags the primary (the WMT case)", () => {
    expect(
      sbcFor(companyFacts({ ...ocf("2026-01-31"), AllocatedShareBasedCompensationExpense: [durationFact("2026-01-31", 3_603_000_000)] })),
    ).toBe(3_603_000_000);
  });

  it("uses the primary alone when a filer never tags the fallback (the JPM case)", () => {
    expect(
      sbcFor(companyFacts({ ...ocf("2025-12-31"), ShareBasedCompensation: [durationFact("2025-12-31", 3_614_000_000)] })),
    ).toBe(3_614_000_000);
  });

  it("is null — never zero — when the filer tags neither concept (the XOM case)", () => {
    const value = sbcFor(companyFacts(ocf("2025-12-31")));
    expect(value).toBeNull();
    expect(value).not.toBe(0);
  });

  it("is null for a year the filer did not report, without shifting other years' values", () => {
    const statements = parseAnnualCashFlowStatements(
      companyFacts({
        ...ocf("2024-12-31", "2025-12-31"),
        ShareBasedCompensation: [durationFact("2025-12-31", 12_863_000_000)],
      }),
      6,
      "sec_edgar",
    );
    expect(statements.map((s) => [s.fiscalYear, s.shareBasedCompensation])).toEqual([
      [2025, 12_863_000_000],
      [2024, null],
    ]);
  });

  it("ignores quarterly comparatives and non-10-K forms, like every other series here", () => {
    const quarterly: XbrlFact = { start: "2025-01-01", end: "2025-03-31", val: 111, fy: 2025, fp: "Q1", form: "10-K", filed: FILED };
    const tenQ: XbrlFact = { ...durationFact("2025-12-31", 999), form: "10-Q" };
    expect(
      sbcFor(
        companyFacts({
          ...ocf("2025-12-31"),
          ShareBasedCompensation: [quarterly, tenQ, durationFact("2025-12-31", 12_863_000_000)],
        }),
      ),
    ).toBe(12_863_000_000);
  });

  it("leaves the rest of the cash flow statement unchanged", () => {
    const [statement] = parseAnnualCashFlowStatements(
      companyFacts({
        NetCashProvidedByUsedInOperatingActivities: [durationFact("2025-12-31", 2_000_000_000)],
        PaymentsToAcquirePropertyPlantAndEquipment: [durationFact("2025-12-31", 500_000_000)],
        DepreciationAndAmortization: [durationFact("2025-12-31", 300_000_000)],
        ShareBasedCompensation: [durationFact("2025-12-31", 400_000_000)],
      }),
      6,
      "sec_edgar",
    );

    expect(statement).toMatchObject({
      fiscalYear: 2025,
      periodKey: "2025-FY",
      operatingCashFlow: 2_000_000_000,
      capitalExpenditures: -500_000_000,
      freeCashFlow: 1_500_000_000,
      depreciationAndAmortization: 300_000_000,
      shareBasedCompensation: 400_000_000,
    });
  });
});

// --------------------------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------------------------

const meta = {
  periodKey: "2025-FY",
  periodType: "FY" as const,
  fiscalYear: 2025,
  periodEnd: "2025-12-31",
  filedAt: null,
  sourceProvider: "test",
};

type PeriodOverrides = Partial<PeriodFinancials["income"]> &
  Partial<PeriodFinancials["balance"]> &
  Partial<PeriodFinancials["cashFlow"]>;

function period(overrides: PeriodOverrides = {}): PeriodFinancials {
  return {
    income: {
      ...meta,
      revenue: 1000,
      costOfRevenue: null,
      grossProfit: 400,
      researchAndDevelopment: null,
      operatingIncome: 200,
      ebit: 200,
      ebitda: null,
      interestExpense: 20,
      pretaxIncome: 180,
      incomeTaxExpense: 36,
      netIncome: 144,
      eps: null,
      epsDiluted: 1.44,
      sharesOutstandingDiluted: 100,
      ...overrides,
    },
    balance: {
      ...meta,
      cashAndEquivalents: 300,
      shortTermInvestments: null,
      receivables: 100,
      inventory: 80,
      totalCurrentAssets: 500,
      totalAssets: 2000,
      intangibleAssets: 50,
      goodwill: 100,
      totalCurrentLiabilities: 300,
      accountsPayable: 90,
      shortTermDebt: null,
      longTermDebt: 400,
      totalDebt: 400,
      totalLiabilities: 900,
      totalEquity: 1100,
      tangibleBookValue: 950,
      retainedEarnings: 500,
      ...overrides,
    },
    cashFlow: {
      ...meta,
      operatingCashFlow: 220,
      capitalExpenditures: -50,
      depreciationAndAmortization: 60,
      shareBasedCompensation: 80,
      freeCashFlow: 170,
      dividendsPaid: -30,
      stockBuybacks: -20,
      stockIssuance: 5,
      netDebtIssuance: null,
      ...overrides,
    },
  };
}

function input(series: PeriodFinancials[]): MetricInput {
  return {
    ticker: "TEST",
    periodKey: series[0].income.periodKey,
    current: series[0],
    series,
    marketCap: 5000,
    enterpriseValue: 5100,
    sharePrice: 50,
    sharesOutstanding: 100,
    momentum: null,
    valuationHistory: [],
  };
}

function definition(key: string) {
  const found = METRIC_DEFINITIONS.find((m) => m.key === key);
  expect(found, `metric "${key}" is missing from the registry`).toBeDefined();
  return found!;
}

describe("sbcToRevenue", () => {
  it("computes share-based compensation over revenue", () => {
    // 80 / 1000 = 0.08
    expect(sbcToRevenue(input([period()]))).toBeCloseTo(0.08, 10);
  });

  it("computes AAPL's FY2025 figures by hand", () => {
    // $12.863bn SBC on $416.161bn revenue = 3.09%.
    const value = sbcToRevenue(input([period({ shareBasedCompensation: 12_863_000_000, revenue: 416_161_000_000 })]));
    expect(value).toBeCloseTo(12_863 / 416_161, 12);
    expect(value).toBeCloseTo(0.0309, 4);
  });

  it("separates two companies with the same revenue but different stock compensation", () => {
    const heavy = sbcToRevenue(input([period({ shareBasedCompensation: 200 })]));
    const light = sbcToRevenue(input([period({ shareBasedCompensation: 10 })]));
    expect(heavy).toBeCloseTo(0.2, 10);
    expect(light).toBeCloseTo(0.01, 10);
    // Direction "asc": the smaller raw number is the better one.
    expect(light!).toBeLessThan(heavy!);
  });

  it("is null when the filer reported no share-based compensation — not zero (the XOM case)", () => {
    expect(sbcToRevenue(input([period({ shareBasedCompensation: null })]))).toBeNull();
  });

  it("treats a statement written before the field existed (undefined) exactly like null", () => {
    const stale = period();
    delete (stale.cashFlow as { shareBasedCompensation?: number | null }).shareBasedCompensation;
    expect(sbcToRevenue(input([stale]))).toBeNull();
  });

  it("is null when revenue is missing, zero, or negative", () => {
    expect(sbcToRevenue(input([period({ revenue: null })]))).toBeNull();
    expect(sbcToRevenue(input([period({ revenue: 0 })]))).toBeNull();
    expect(sbcToRevenue(input([period({ revenue: -500 })]))).toBeNull();
  });

  it("is zero, not null, for a filer that genuinely reports zero", () => {
    expect(sbcToRevenue(input([period({ shareBasedCompensation: 0 })]))).toBe(0);
  });
});

describe("sbcToFcf", () => {
  it("computes share-based compensation over free cash flow", () => {
    // 80 / 170 = 0.4706
    expect(sbcToFcf(input([period()]))).toBeCloseTo(80 / 170, 12);
  });

  it("shows how much of headline free cash flow was funded by issuing stock", () => {
    // FCF of 100 with 50 of SBC added back: half the reported free cash flow is compensation
    // the company never funded in cash.
    expect(sbcToFcf(input([period({ freeCashFlow: 100, shareBasedCompensation: 50 })]))).toBeCloseTo(0.5, 10);
  });

  it("is suppressed rather than negative when free cash flow is negative", () => {
    // The metric is "asc", so a negative ratio would rank a cash-burning company as the least
    // stock-compensated name in the universe.
    expect(sbcToFcf(input([period({ freeCashFlow: -400, shareBasedCompensation: 80 })]))).toBeNull();
  });

  it("is suppressed rather than infinite when free cash flow is exactly zero", () => {
    expect(sbcToFcf(input([period({ freeCashFlow: 0, shareBasedCompensation: 80 })]))).toBeNull();
  });

  it("is null when free cash flow is missing", () => {
    expect(sbcToFcf(input([period({ freeCashFlow: null })]))).toBeNull();
  });

  it("is null when the filer reported no share-based compensation, whatever the cash flow", () => {
    expect(sbcToFcf(input([period({ shareBasedCompensation: null })]))).toBeNull();
    const stale = period();
    delete (stale.cashFlow as { shareBasedCompensation?: number | null }).shareBasedCompensation;
    expect(sbcToFcf(input([stale]))).toBeNull();
  });

  it("still computes a ratio above 1 when compensation exceeds free cash flow", () => {
    // Not an error state and not suppressed: it is the headline finding for a company whose
    // entire free cash flow is smaller than its stock compensation bill.
    expect(sbcToFcf(input([period({ freeCashFlow: 50, shareBasedCompensation: 80 })]))).toBeCloseTo(1.6, 10);
  });
});

describe("share-based compensation — registry wiring", () => {
  it("both metrics rank lower-is-better: stock compensation is an expense", () => {
    expect(definition("sbc_to_revenue").direction).toBe("asc");
    expect(definition("sbc_to_fcf").direction).toBe("asc");
  });

  it("categorises both as earnings quality, not capital allocation", () => {
    // The question they answer is what an expense costs and how much of reported cash flow it
    // inflates — an accounting-quality question. capitalAllocation already carries the OUTCOME
    // of the same fact as `share_count_change`; putting the cost there too would score one
    // decision twice inside one category.
    expect(definition("sbc_to_revenue").category).toBe("earningsQuality");
    expect(definition("sbc_to_fcf").category).toBe("earningsQuality");
  });

  it("flags only the free-cash-flow one negativeIsBad", () => {
    // sbc_to_revenue's denominator is guarded strictly positive and its numerator can't be
    // negative, so a negative reading is unreachable; sbc_to_fcf carries the flag as a standing
    // guard in case its FCF suppression is ever loosened.
    expect(definition("sbc_to_fcf").negativeIsBad).toBe(true);
    expect(definition("sbc_to_revenue").negativeIsBad).not.toBe(true);
  });

  it("weights the fragile FCF version below the stable revenue one, by verdict", () => {
    const revenueVerdict = getMetricRationale("sbc_to_revenue", "earningsQuality").verdict;
    const fcfVerdict = getMetricRationale("sbc_to_fcf", "earningsQuality").verdict;
    expect(revenueVerdict).toBe("supporting");
    expect(fcfVerdict).toBe("caveat");
    expect(VERDICT_DEFAULT_WEIGHT[fcfVerdict]).toBeLessThan(VERDICT_DEFAULT_WEIGHT[revenueVerdict]);
  });

  it("does not duplicate share_count_change, which measures dilution rather than its cost", () => {
    expect(definition("share_count_change").category).toBe("capitalAllocation");
    expect(METRIC_DEFINITIONS.filter((m) => m.key.startsWith("sbc_")).map((m) => m.key).sort()).toEqual([
      "sbc_to_fcf",
      "sbc_to_revenue",
    ]);
  });
});

describe("share-based compensation — sector applicability", () => {
  it("keeps SBC / revenue applicable to Financials — stock compensation is a real cost for a bank", () => {
    expect(isMetricApplicable("sbc_to_revenue", "Financials")).toBe(true);
    expect(isMetricApplicable("sbc_to_revenue", "Financial Services")).toBe(true);
  });

  it("excludes SBC / free cash flow for Financials, alongside every other FCF-denominated metric", () => {
    expect(isMetricApplicable("sbc_to_fcf", "Financials")).toBe(false);
    expect(inapplicabilityReason("sbc_to_fcf", "Financials")).toBe(
      inapplicabilityReason("fcf_to_revenue", "Financials"),
    );
  });

  it("keeps both applicable to Real Estate", () => {
    // The REIT distortion this module gates on is property depreciation inside reported
    // EARNINGS. Neither metric touches earnings, and every FCF-denominated metric already stays
    // applicable to REITs, so excluding these would remove real information (Realty Income
    // reports $30.8M of share-based compensation for FY2025) rather than avoid a wrong number.
    expect(isMetricApplicable("sbc_to_revenue", "Real Estate")).toBe(true);
    expect(isMetricApplicable("sbc_to_fcf", "Real Estate")).toBe(true);
    expect(isMetricApplicable("sbc_to_fcf", "REIT")).toBe(true);
  });

  it("keeps both applicable everywhere else, including a company with no sector on record", () => {
    for (const key of ["sbc_to_revenue", "sbc_to_fcf"]) {
      expect(isMetricApplicable(key, "Technology")).toBe(true);
      expect(isMetricApplicable(key, null)).toBe(true);
    }
  });
});
