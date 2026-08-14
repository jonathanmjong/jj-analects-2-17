import { describe, expect, it } from "vitest";
import {
  parseAnnualFundamentalsHistory,
  parsePublicFloatHistory,
  type CompanyConceptJson,
  type CompanyFacts,
  type XbrlFact,
} from "../src/providers/SecEdgarProvider.js";
import { buildValuationHistoryDocs } from "../src/ingestion/ingestValuationHistory.js";
import { isPlausibleMarketCap } from "../src/ingestion/ingestPrices.js";

const floatFact = (over: Partial<XbrlFact> & { end: string; val: number; fy: number }): XbrlFact => ({
  fp: "FY",
  form: "10-K",
  filed: `${over.fy + 1}-11-01`,
  ...over,
});

const floatConcept = (facts: XbrlFact[]): CompanyConceptJson => ({
  cik: 320193,
  taxonomy: "dei",
  tag: "EntityPublicFloat",
  units: { USD: facts },
});

/** Duration (income-statement) fact: an annual-length period ending at the fiscal year end. */
const durationFact = (fiscalYearEnd: string, val: number, fy: number): XbrlFact => {
  const start = new Date(new Date(fiscalYearEnd).getTime() - 364 * 86_400_000).toISOString().slice(0, 10);
  return { start, end: fiscalYearEnd, val, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-11-01` };
};

const instantFact = (fiscalYearEnd: string, val: number, fy: number): XbrlFact => ({
  end: fiscalYearEnd,
  val,
  fy,
  fp: "FY",
  form: "10-K",
  filed: `${fy + 1}-11-01`,
});

const companyFacts = (usGaap: Record<string, XbrlFact[]>): CompanyFacts => ({
  facts: {
    "us-gaap": Object.fromEntries(Object.entries(usGaap).map(([tag, facts]) => [tag, { units: { USD: facts } }])),
  },
});

describe("parsePublicFloatHistory", () => {
  it("returns one observation per fiscal year, oldest first", () => {
    const history = parsePublicFloatHistory(
      floatConcept([
        floatFact({ end: "2024-03-29", val: 2_628_553_000_000, fy: 2024 }),
        floatFact({ end: "2022-03-25", val: 2_830_068_000_000, fy: 2022 }),
        floatFact({ end: "2023-03-31", val: 2_591_165_000_000, fy: 2023 }),
      ]),
    );

    expect(history.map((h) => h.fiscalYear)).toEqual([2022, 2023, 2024]);
    expect(history[2]).toEqual({ fiscalYear: 2024, asOf: "2024-03-29", publicFloat: 2_628_553_000_000 });
  });

  it("keeps 10-K and 10-K/A cover pages, drops every other form", () => {
    const history = parsePublicFloatHistory(
      floatConcept([
        floatFact({ end: "2023-06-30", val: 5_000_000_000, fy: 2023, form: "10-Q" }),
        floatFact({ end: "2024-06-28", val: 6_000_000_000, fy: 2024, form: "10-K" }),
        floatFact({ end: "2022-07-01", val: 4_000_000_000, fy: 2022, form: "10-K/A" }),
        floatFact({ end: "2021-06-30", val: 3_000_000_000, fy: 2021, form: "S-1" }),
      ]),
    );

    expect(history.map((h) => h.fiscalYear)).toEqual([2022, 2024]);
  });

  it("dedupes a fiscal year to the observation with the latest cover-page date", () => {
    const history = parsePublicFloatHistory(
      floatConcept([
        floatFact({ end: "2024-06-28", val: 6_000_000_000, fy: 2024, filed: "2025-02-01" }),
        floatFact({ end: "2024-12-31", val: 7_500_000_000, fy: 2024, form: "10-K/A", filed: "2025-03-01" }),
      ]),
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ asOf: "2024-12-31", publicFloat: 7_500_000_000 });
  });

  it("breaks a same-date tie on the later filing", () => {
    const history = parsePublicFloatHistory(
      floatConcept([
        floatFact({ end: "2024-06-28", val: 6_000_000_000, fy: 2024, filed: "2024-11-01" }),
        floatFact({ end: "2024-06-28", val: 6_100_000_000, fy: 2024, form: "10-K/A", filed: "2025-02-14" }),
      ]),
    );

    expect(history[0].publicFloat).toBe(6_100_000_000);
  });

  it("caps at the most recent 12 fiscal years", () => {
    const facts = Array.from({ length: 17 }, (_, i) =>
      floatFact({ end: `${2009 + i}-06-30`, val: 5_000_000_000, fy: 2009 + i }),
    );

    const history = parsePublicFloatHistory(floatConcept(facts));

    expect(history).toHaveLength(12);
    expect(history[0].fiscalYear).toBe(2014);
    expect(history[11].fiscalYear).toBe(2025);
  });

  it("rejects implausible floats via the injected guard, keeping the rest of the series", () => {
    const history = parsePublicFloatHistory(
      floatConcept([
        floatFact({ end: "2023-06-30", val: 4_000_000_000, fy: 2023 }),
        // Cabot Corp's real filing: off by exactly 10^6x.
        floatFact({ end: "2024-06-28", val: 4_429_047_299_000_000, fy: 2024 }),
      ]),
      (publicFloat) => isPlausibleMarketCap(publicFloat),
    );

    expect(history.map((h) => h.fiscalYear)).toEqual([2023]);
  });

  it("drops non-positive values and handles a missing/empty concept", () => {
    expect(parsePublicFloatHistory(floatConcept([floatFact({ end: "2024-06-28", val: 0, fy: 2024 })]))).toEqual([]);
    expect(parsePublicFloatHistory(null)).toEqual([]);
    expect(parsePublicFloatHistory({ units: {} })).toEqual([]);
  });
});

describe("parseAnnualFundamentalsHistory", () => {
  it("assembles per-year line items and the real period end, nulls where untagged", () => {
    const facts = companyFacts({
      NetIncomeLoss: [durationFact("2023-12-31", 100, 2023), durationFact("2024-12-31", 120, 2024)],
      Revenues: [durationFact("2023-12-31", 1000, 2023), durationFact("2024-12-31", 1100, 2024)],
      StockholdersEquity: [instantFact("2023-12-31", 500, 2023), instantFact("2024-12-31", 560, 2024)],
      OperatingIncomeLoss: [durationFact("2024-12-31", 150, 2024)],
      LongTermDebtNoncurrent: [instantFact("2024-12-31", 300, 2024)],
      CashAndCashEquivalentsAtCarryingValue: [instantFact("2024-12-31", 80, 2024)],
      WeightedAverageNumberOfDilutedSharesOutstanding: [durationFact("2024-12-31", 50, 2024)],
    });

    const history = parseAnnualFundamentalsHistory(facts);

    expect(history.map((h) => h.fiscalYear)).toEqual([2023, 2024]);
    expect(history[0]).toEqual({
      fiscalYear: 2023,
      periodEnd: "2023-12-31",
      netIncome: 100,
      revenue: 1000,
      totalEquity: 500,
      operatingIncome: null,
      totalDebt: null,
      cashAndEquivalents: null,
      sharesOutstandingDiluted: null,
    });
    expect(history[1]).toMatchObject({ operatingIncome: 150, totalDebt: 300, cashAndEquivalents: 80 });
  });

  it("ignores quarterly comparatives and non-10-K forms", () => {
    const quarterly: XbrlFact = { start: "2024-01-01", end: "2024-03-31", val: 250, fy: 2024, fp: "Q1", form: "10-K", filed: "2025-11-01" };
    const tenQ: XbrlFact = { ...durationFact("2024-12-31", 999, 2024), form: "10-Q" };
    const facts = companyFacts({ Revenues: [durationFact("2024-12-31", 1100, 2024), quarterly, tenQ] });

    const history = parseAnnualFundamentalsHistory(facts);

    expect(history).toHaveLength(1);
    expect(history[0].revenue).toBe(1100);
  });

  it("caps at the requested number of years, keeping the most recent", () => {
    const facts = companyFacts({
      NetIncomeLoss: Array.from({ length: 17 }, (_, i) => durationFact(`${2009 + i}-12-31`, 100 + i, 2009 + i)),
    });

    const history = parseAnnualFundamentalsHistory(facts, 12);

    expect(history).toHaveLength(12);
    expect(history[0].fiscalYear).toBe(2014);
    expect(history[11].fiscalYear).toBe(2025);
  });

  it("returns an empty history for missing facts", () => {
    expect(parseAnnualFundamentalsHistory(null)).toEqual([]);
    expect(parseAnnualFundamentalsHistory({})).toEqual([]);
  });
});

describe("buildValuationHistoryDocs", () => {
  const fundamentals = (over: Partial<ReturnType<typeof baseYear>> & { fiscalYear: number; periodEnd: string }) => ({
    ...baseYear(over.fiscalYear, over.periodEnd),
    ...over,
  });

  function baseYear(fiscalYear: number, periodEnd: string) {
    return {
      fiscalYear,
      periodEnd,
      netIncome: 200_000_000 as number | null,
      revenue: 2_000_000_000 as number | null,
      totalEquity: 1_000_000_000 as number | null,
      operatingIncome: 300_000_000 as number | null,
      totalDebt: 600_000_000 as number | null,
      cashAndEquivalents: 150_000_000 as number | null,
      sharesOutstandingDiluted: 50_000_000 as number | null,
    };
  }

  it("writes the agreed doc shape, joining each float to the year it falls inside", () => {
    const docs = buildValuationHistoryDocs(
      [{ fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 9_000_000_000 }],
      [fundamentals({ fiscalYear: 2024, periodEnd: "2024-12-31" })],
    );

    expect(docs).toEqual([
      {
        fiscalYear: 2024,
        floatAsOf: "2024-06-28",
        publicFloat: 9_000_000_000,
        netIncome: 200_000_000,
        revenue: 2_000_000_000,
        totalEquity: 1_000_000_000,
        operatingIncome: 300_000_000,
        totalDebt: 600_000_000,
        cash: 150_000_000,
        sharesOutstanding: 50_000_000,
        impliedFloatRatio: null,
        floatBasis: "dei_entity_public_float_cover_date",
        source: "sec_edgar",
      },
    ]);
  });

  it("preserves nulls rather than zero-filling them", () => {
    const docs = buildValuationHistoryDocs(
      [{ fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 9_000_000_000 }],
      [
        fundamentals({
          fiscalYear: 2024,
          periodEnd: "2024-12-31",
          revenue: null,
          totalDebt: null,
          cashAndEquivalents: null,
          sharesOutstandingDiluted: null,
        }),
      ],
    );

    expect(docs[0]).toMatchObject({ revenue: null, totalDebt: null, cash: null, sharesOutstanding: null });
  });

  it("aligns a January-fiscal-year-end filer to the year the float falls inside, not the label", () => {
    // Float measured July 2024 belongs to the year ending January 2025 (labelled 2025 here),
    // even though SEC's own fiscal-year focus for that filing is 2024.
    const docs = buildValuationHistoryDocs(
      [{ fiscalYear: 2024, asOf: "2024-07-31", publicFloat: 9_000_000_000 }],
      [
        fundamentals({ fiscalYear: 2024, periodEnd: "2024-01-31", netIncome: 90_000_000 }),
        fundamentals({ fiscalYear: 2025, periodEnd: "2025-01-31", netIncome: 110_000_000 }),
      ],
    );

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ fiscalYear: 2025, netIncome: 110_000_000 });
  });

  it("drops a float whose fiscal year has no fundamentals rather than reaching into another year", () => {
    const docs = buildValuationHistoryDocs(
      [
        { fiscalYear: 2023, asOf: "2023-06-30", publicFloat: 8_000_000_000 },
        { fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 9_000_000_000 },
      ],
      [fundamentals({ fiscalYear: 2024, periodEnd: "2024-12-31" })],
    );

    expect(docs.map((d) => d.fiscalYear)).toEqual([2024]);
  });

  it("skips a year whose fundamentals are all unusable denominators", () => {
    const docs = buildValuationHistoryDocs(
      [{ fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 9_000_000_000 }],
      [
        fundamentals({
          fiscalYear: 2024,
          periodEnd: "2024-12-31",
          netIncome: null,
          revenue: null,
          totalEquity: null,
          operatingIncome: null,
        }),
      ],
    );

    expect(docs).toEqual([]);
  });

  it("rejects a float that is implausible against that year's own revenue", () => {
    // Champion Homes' real filing: off by 10^3x, under the absolute ceiling but ~1,900x revenue.
    const docs = buildValuationHistoryDocs(
      [
        { fiscalYear: 2023, asOf: "2023-06-30", publicFloat: 2_000_000_000 },
        { fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 4_135_959_950_000 },
      ],
      [
        fundamentals({ fiscalYear: 2023, periodEnd: "2023-12-31", revenue: 2_140_000_000 }),
        fundamentals({ fiscalYear: 2024, periodEnd: "2024-12-31", revenue: 2_140_000_000 }),
      ],
    );

    expect(docs.map((d) => d.fiscalYear)).toEqual([2023]);
  });

  it("falls back to the fiscal-year label only when no period end dates exist at all", () => {
    const docs = buildValuationHistoryDocs(
      [{ fiscalYear: 2024, asOf: "2024-06-28", publicFloat: 9_000_000_000 }],
      [{ ...baseYear(2024, ""), periodEnd: null }],
    );

    expect(docs.map((d) => d.fiscalYear)).toEqual([2024]);
  });
});
