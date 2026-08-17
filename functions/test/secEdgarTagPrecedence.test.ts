import { describe, expect, it } from "vitest";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import {
  COST_OF_REVENUE_TAGS,
  GROSS_PROFIT_TAGS,
  SecEdgarProvider,
  TOTAL_DEBT_TAGS,
  parseAnnualFundamentalsHistory,
} from "../src/providers/SecEdgarProvider.js";

/**
 * Gross profit was resolved from the single tag `GrossProfit` (null for 58% of the universe) and
 * total debt from the single tag `LongTermDebtNoncurrent` (null for ~48%) — while `costOfRevenue`
 * was hardcoded null and never fetched at all. A null totalDebt is not a null downstream:
 * ingestPrices reads it as ZERO, so enterprise value silently understated debt for half the
 * universe.
 *
 * Both fields now resolve through strict per-period precedence, for the same reason net income
 * does (see netIncomeFallback.test.ts): the candidate tags carry DIFFERENT accounting bases, and
 * within one filing every tag shares a `filed` date, so a plain `annualSeries` merge would let
 * array order decide which basis a company lands on. Verified live on EDGAR:
 *   - `LongTermDebtAndCapitalLeaseObligations` is the same noncurrent basis as
 *     `LongTermDebtNoncurrent` (identical in 44 of 58 overlapping periods across 31 filers), but
 *     `LongTermDebt` includes current maturities (AAPL FY2025: $90.7B vs $78.3B) and
 *     `DebtLongtermAndShorttermCombinedAmount` includes short-term borrowings (0 of 42 periods
 *     matched). Order is by basis proximity, primary first.
 *   - `CostOfRevenue` equalled revenue - GrossProfit in 214/214 periods;
 *     `CostOfGoodsAndServicesSold` in 258/270. CAT reports BOTH for FY2025 at $44.8B and $49M, so
 *     order decides whether CAT's gross margin is ~34% or ~99.9%.
 */

const FILED = "2026-02-20";

function durationFact(end: string, val: number, filed = FILED): XbrlFact {
  const start = new Date(new Date(end).getTime() - 364 * 86_400_000).toISOString().slice(0, 10);
  return { start, end, val, fy: new Date(end).getUTCFullYear(), fp: "FY", form: "10-K", filed };
}

/** Balance-sheet concepts are "instant" facts — no `start`, so no duration filter applies. */
function instantFact(end: string, val: number, filed = FILED): XbrlFact {
  return { end, val, fy: new Date(end).getUTCFullYear(), fp: "FY", form: "10-K", filed };
}

function companyFacts(tags: Record<string, XbrlFact[]>): CompanyFacts {
  return {
    facts: {
      "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, facts]) => [tag, { units: { USD: facts } }])),
    },
  };
}

const revenueFacts = (...pairs: Array<[string, number]>) => ({
  Revenues: pairs.map(([end, val]) => durationFact(end, val)),
});

/** Balance sheets are emitted for the fiscal years `Assets` covers, so every case needs one. */
const assetFacts = (...ends: string[]) => ({
  Assets: ends.map((end, i) => instantFact(end, 500_000_000_000 + i)),
});

const provider = new SecEdgarProvider();

type PrivateExtractors = {
  extractIncomeStatements(
    f: CompanyFacts,
    p: number,
    t?: string,
  ): { fiscalYear: number; revenue: number | null; costOfRevenue: number | null; grossProfit: number | null }[];
  extractBalanceSheets(
    f: CompanyFacts,
    p: number,
    t?: string,
  ): { fiscalYear: number; longTermDebt: number | null; totalDebt: number | null }[];
};

const incomeFor = (facts: CompanyFacts, periods = 5) =>
  (provider as unknown as PrivateExtractors).extractIncomeStatements(facts, periods);

const balanceFor = (facts: CompanyFacts, periods = 5) =>
  (provider as unknown as PrivateExtractors).extractBalanceSheets(facts, periods);

const grossProfitByYear = (facts: CompanyFacts, periods = 5) =>
  Object.fromEntries(incomeFor(facts, periods).map((s) => [s.fiscalYear, s.grossProfit]));

const costByYear = (facts: CompanyFacts, periods = 5) =>
  Object.fromEntries(incomeFor(facts, periods).map((s) => [s.fiscalYear, s.costOfRevenue]));

const totalDebtByYear = (facts: CompanyFacts, periods = 5) =>
  Object.fromEntries(balanceFor(facts, periods).map((s) => [s.fiscalYear, s.totalDebt]));

describe("SEC EDGAR — total debt tag precedence", () => {
  it("documents its precedence in one place, primary first", () => {
    expect(TOTAL_DEBT_TAGS).toEqual([
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      "LongTermNotesPayable",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
      "DebtLongtermAndShorttermCombinedAmount",
    ]);
  });

  it("keeps LongTermDebtNoncurrent when fallbacks are present for the same period at the same filed date", () => {
    // THE regression this guards. Every currently-correct company resolves to the primary tag, and
    // filers commonly report several debt tags in ONE filing — so `filed` cannot break the tie and
    // a plain merge would hand the decision to array order. AAPL's real FY2025 figures.
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-09-27"),
        LongTermDebtNoncurrent: [instantFact("2025-09-27", 78_328_000_000)],
        LongTermDebt: [instantFact("2025-09-27", 90_678_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 78_328_000_000 });
  });

  it("is not sensitive to which tag appears first in the response object", () => {
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        DebtLongtermAndShorttermCombinedAmount: [instantFact("2025-12-31", 42_503_000_000)],
        LongTermDebt: [instantFact("2025-12-31", 29_474_000_000)],
        LongTermDebtNoncurrent: [instantFact("2025-12-31", 40_868_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 40_868_000_000 });
  });

  it("does not let a later-filed fallback restatement displace the primary for that period", () => {
    // Within ONE tag later-filed wins; ACROSS tags a fresher filing of a different basis is still
    // a different basis.
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtNoncurrent: [instantFact("2025-12-31", 30_696_000_000, "2026-02-20")],
        LongTermDebt: [instantFact("2025-12-31", 38_000_000_000, "2026-08-01")],
      }),
    );

    expect(byYear).toEqual({ 2025: 30_696_000_000 });
  });

  it("still lets a later-filed restatement of the primary tag itself win", () => {
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtNoncurrent: [
          instantFact("2025-12-31", 30_696_000_000, "2026-02-20"),
          instantFact("2025-12-31", 30_500_000_000, "2026-08-01"),
        ],
      }),
    );

    expect(byYear).toEqual({ 2025: 30_500_000_000 });
  });

  it("prefers the same-basis lease tag over the includes-current-maturities one (the XOM/CVX case)", () => {
    // LongTermDebtAndCapitalLeaseObligations is noncurrent long-term debt plus finance leases —
    // the nearest neighbour of the primary. XOM has carried no other tag since FY2017.
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtAndCapitalLeaseObligations: [instantFact("2025-12-31", 34_241_000_000)],
        LongTermDebt: [instantFact("2025-12-31", 40_441_000_000)],
        DebtLongtermAndShorttermCombinedAmount: [instantFact("2025-12-31", 43_537_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 34_241_000_000 });
  });

  it("prefers noncurrent notes payable over a lone zero-valued LongTermDebt (the ORCL case)", () => {
    // Oracle tags a dimensionless LongTermDebt of ZERO for FY2022 while carrying its real
    // borrowings under LongTermNotesPayable. Ranking LongTermDebt higher would report no debt at
    // all — precisely the silent-zero-EV failure this whole change exists to remove.
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2022-05-31"),
        LongTermNotesPayable: [instantFact("2022-05-31", 72_110_000_000)],
        LongTermDebt: [instantFact("2022-05-31", 0)],
      }),
    );

    expect(byYear).toEqual({ 2022: 72_110_000_000 });
  });

  it("falls through to the short+long combined figure only as a last resort (the GS case)", () => {
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        DebtLongtermAndShorttermCombinedAmount: [instantFact("2025-12-31", 355_959_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 355_959_000_000 });
  });

  it("resolves each fiscal period independently, with no cross-year basis bleed (the GS/CVX case)", () => {
    // A filer that reported the primary tag for older years and switched: the old years must KEEP
    // the noncurrent basis rather than being restated onto whatever covers the latest year.
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"),
        LongTermDebtNoncurrent: [instantFact("2022-12-31", 1_000), instantFact("2023-12-31", 1_100)],
        LongTermDebtAndCapitalLeaseObligations: [
          instantFact("2022-12-31", 1_050),
          instantFact("2023-12-31", 1_150),
          instantFact("2024-12-31", 1_250),
        ],
        DebtLongtermAndShorttermCombinedAmount: [
          instantFact("2022-12-31", 1_800),
          instantFact("2023-12-31", 1_900),
          instantFact("2024-12-31", 2_000),
          instantFact("2025-12-31", 2_100),
        ],
      }),
    );

    expect(byYear).toEqual({ 2025: 2_100, 2024: 1_250, 2023: 1_100, 2022: 1_000 });
  });

  it("leaves a year null when no tag has a qualifying fact for it", () => {
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2024-12-31", "2025-12-31"),
        LongTermDebt: [instantFact("2025-12-31", 12_768_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 12_768_000_000, 2024: null });
  });

  it("rejects fallback facts that fail the existing selection rules", () => {
    // Widening the tag set must not widen what counts as an annual fact: non-10-K forms are still
    // filtered, per tag, exactly as before.
    const tenQ: XbrlFact = { ...instantFact("2025-12-31", 999), form: "10-Q" };
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtAndCapitalLeaseObligations: [tenQ],
        LongTermDebt: [instantFact("2025-12-31", 49_397_000_000)],
      }),
    );

    // The rejected fact must not count as "higher-precedence tag present" either.
    expect(byYear).toEqual({ 2025: 49_397_000_000 });
  });

  it("does not let a disqualified primary fact block the fallback", () => {
    const tenQ: XbrlFact = { ...instantFact("2025-12-31", 999), form: "10-Q" };
    const byYear = totalDebtByYear(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtNoncurrent: [tenQ],
        LongTermDebtAndCapitalLeaseObligations: [instantFact("2025-12-31", 65_649_000_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 65_649_000_000 });
  });

  it("keeps longTermDebt and totalDebt on the same resolved figure", () => {
    const [sheet] = balanceFor(
      companyFacts({
        ...assetFacts("2025-12-31"),
        LongTermDebtAndCapitalLeaseObligations: [instantFact("2025-12-31", 65_649_000_000)],
      }),
    );

    expect(sheet.longTermDebt).toBe(65_649_000_000);
    expect(sheet.totalDebt).toBe(65_649_000_000);
  });
});

describe("SEC EDGAR — cost of revenue tag precedence", () => {
  it("documents its precedence in one place", () => {
    expect(COST_OF_REVENUE_TAGS).toEqual(["CostOfRevenue", "CostOfGoodsAndServicesSold"]);
  });

  it("excludes the goods/services component tags entirely", () => {
    // CostOfGoodsSold and CostOfServices are one line of a split, not the total, in >90% of
    // periods measured (ADBE FY2017: $57M tagged against a real $1,010M cost of revenue).
    expect(COST_OF_REVENUE_TAGS).not.toContain("CostOfGoodsSold");
    expect(COST_OF_REVENUE_TAGS).not.toContain("CostOfServices");
  });

  it("ignores a component tag rather than deriving a gross profit from it", () => {
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 67_589_000_000]),
      CostOfGoodsSold: [durationFact("2025-12-31", 31_049_000_000)],
      CostOfServices: [durationFact("2025-12-31", 7_631_000_000)],
    });

    expect(costByYear(facts)).toEqual({ 2025: null });
    expect(grossProfitByYear(facts)).toEqual({ 2025: null });
  });

  it("prefers CostOfRevenue over a same-period CostOfGoodsAndServicesSold sliver (the CAT case)", () => {
    // CAT tags both for FY2025: $44.752B (the real total) and $49M (a rounding-error line). The
    // reverse order would report a ~99.9% gross margin.
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 67_589_000_000]),
      CostOfGoodsAndServicesSold: [durationFact("2025-12-31", 49_000_000)],
      CostOfRevenue: [durationFact("2025-12-31", 44_752_000_000)],
    });

    expect(costByYear(facts)).toEqual({ 2025: 44_752_000_000 });
    expect(grossProfitByYear(facts)).toEqual({ 2025: 22_837_000_000 });
  });

  it("falls back to CostOfGoodsAndServicesSold when CostOfRevenue is absent", () => {
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 65_179_000_000]),
      CostOfGoodsAndServicesSold: [durationFact("2025-12-31", 11_052_000_000)],
    });

    expect(costByYear(facts)).toEqual({ 2025: 11_052_000_000 });
  });

  it("resolves each fiscal period independently across a mid-history tag switch", () => {
    // MSFT-shaped: CostOfRevenue through FY2017, CostOfGoodsAndServicesSold from FY2016 on. The
    // overlapping year must stay on the primary, not be restated onto the newer tag.
    const facts = companyFacts({
      ...revenueFacts(
        ["2022-06-30", 198_270_000_000],
        ["2023-06-30", 211_915_000_000],
        ["2024-06-30", 245_122_000_000],
        ["2025-06-30", 281_724_000_000],
      ),
      CostOfRevenue: [durationFact("2022-06-30", 62_650_000_000), durationFact("2023-06-30", 65_863_000_000)],
      CostOfGoodsAndServicesSold: [
        durationFact("2022-06-30", 62_000_000_000),
        durationFact("2023-06-30", 65_000_000_000),
        durationFact("2024-06-30", 74_114_000_000),
        durationFact("2025-06-30", 86_000_000_000),
      ],
    });

    expect(costByYear(facts)).toEqual({
      2025: 86_000_000_000,
      2024: 74_114_000_000,
      2023: 65_863_000_000,
      2022: 62_650_000_000,
    });
  });

  it("rejects cost facts that fail the existing selection rules", () => {
    const quarterly: XbrlFact = {
      start: "2025-10-01", end: "2025-12-31", val: 111, fy: 2025, fp: "Q4", form: "10-K", filed: FILED,
    };
    const tenQ: XbrlFact = { ...durationFact("2025-12-31", 999), form: "10-Q" };

    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 5_000_000_000]),
      CostOfRevenue: [quarterly, tenQ],
      CostOfGoodsAndServicesSold: [durationFact("2025-12-31", 3_000_000_000)],
    });

    // A disqualified primary fact must not block the fallback, and must not leak a quarterly value.
    expect(costByYear(facts)).toEqual({ 2025: 3_000_000_000 });
  });

  it("does not let a later-filed fallback displace the primary for that period", () => {
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 5_000_000_000]),
      CostOfRevenue: [durationFact("2025-12-31", 3_000_000_000, "2026-02-20")],
      CostOfGoodsAndServicesSold: [durationFact("2025-12-31", 3_900_000_000, "2026-08-01")],
    });

    expect(costByYear(facts)).toEqual({ 2025: 3_000_000_000 });
  });
});

describe("SEC EDGAR — gross profit resolution and derivation", () => {
  it("documents its precedence in one place", () => {
    expect(GROSS_PROFIT_TAGS).toEqual(["GrossProfit"]);
  });

  it("uses the reported GrossProfit when the filer publishes one", () => {
    const facts = companyFacts({
      ...revenueFacts(["2025-09-27", 416_161_000_000]),
      GrossProfit: [durationFact("2025-09-27", 195_201_000_000)],
      CostOfGoodsAndServicesSold: [durationFact("2025-09-27", 220_960_000_000)],
    });

    expect(grossProfitByYear(facts)).toEqual({ 2025: 195_201_000_000 });
  });

  it("never overrides a reported GrossProfit, even when revenue minus cost disagrees with it", () => {
    // The reported subtotal is the filer's own statement of the figure — derivation is a fallback
    // for its absence, never a correction of it.
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 100_000_000_000]),
      GrossProfit: [durationFact("2025-12-31", 40_000_000_000)],
      CostOfRevenue: [durationFact("2025-12-31", 25_000_000_000)],
    });

    expect(grossProfitByYear(facts)).toEqual({ 2025: 40_000_000_000 });
  });

  it("derives revenue minus cost of revenue when GrossProfit is absent (the MRK/LLY/UNH/PG case)", () => {
    // These filers have no GrossProfit concept in any year — the single largest slice of the 58%
    // that used to be null.
    const facts = companyFacts({
      ...revenueFacts(["2025-12-31", 65_011_000_000]),
      CostOfGoodsAndServicesSold: [durationFact("2025-12-31", 16_382_000_000)],
    });

    expect(grossProfitByYear(facts)).toEqual({ 2025: 48_629_000_000 });
  });

  it("stays null when revenue is missing", () => {
    // Revenue drives which fiscal years are emitted at all, so drive the years off net income and
    // leave revenue genuinely absent for the period.
    const facts = companyFacts({
      NetIncomeLoss: [durationFact("2025-12-31", 5_000_000_000)],
      CostOfRevenue: [durationFact("2025-12-31", 16_382_000_000)],
    });

    expect(grossProfitByYear(facts)).toEqual({ 2025: null });
  });

  it("stays null when cost of revenue is missing", () => {
    const facts = companyFacts({ ...revenueFacts(["2025-12-31", 26_885_000_000]) });

    expect(grossProfitByYear(facts)).toEqual({ 2025: null });
  });

  it("derives per period, mixing reported and derived years in one history", () => {
    // A filer that dropped the GrossProfit subtotal partway through: the reported years must stay
    // exactly as filed while only the gaps are derived.
    const facts = companyFacts({
      ...revenueFacts(
        ["2022-12-31", 1_000],
        ["2023-12-31", 1_100],
        ["2024-12-31", 1_200],
        ["2025-12-31", 1_300],
      ),
      GrossProfit: [durationFact("2022-12-31", 400), durationFact("2023-12-31", 450)],
      CostOfRevenue: [
        durationFact("2022-12-31", 550),
        durationFact("2023-12-31", 600),
        durationFact("2024-12-31", 700),
      ],
    });

    // 2022/2023 reported (NOT 1000-550=450 / 1100-600=500), 2024 derived, 2025 null — no cost.
    expect(grossProfitByYear(facts)).toEqual({ 2025: null, 2024: 500, 2023: 450, 2022: 400 });
  });

  it("derives a zero or negative gross profit rather than discarding it", () => {
    // A loss-making period is real data, and `0` must survive the null-coalescing chain.
    const facts = companyFacts({
      ...revenueFacts(["2024-12-31", 1_000], ["2025-12-31", 1_000]),
      CostOfRevenue: [durationFact("2024-12-31", 1_000), durationFact("2025-12-31", 1_400)],
    });

    expect(grossProfitByYear(facts)).toEqual({ 2025: -400, 2024: 0 });
  });

  it("populates costOfRevenue on the statement, which used to be hardcoded null", () => {
    const [statement] = incomeFor(
      companyFacts({
        ...revenueFacts(["2025-12-31", 45_183_036_000]),
        CostOfRevenue: [durationFact("2025-12-31", 23_275_329_000)],
      }),
    );

    expect(statement).toMatchObject({
      fiscalYear: 2025,
      revenue: 45_183_036_000,
      costOfRevenue: 23_275_329_000,
      grossProfit: 21_907_707_000,
    });
  });
});

describe("SEC EDGAR — total debt fallback in the valuation-history parse", () => {
  it("applies the same precedence there as in the balance sheet", () => {
    const history = parseAnnualFundamentalsHistory(
      companyFacts({
        StockholdersEquity: [instantFact("2025-12-31", 10_000_000)],
        LongTermDebtAndCapitalLeaseObligations: [instantFact("2025-12-31", 34_241_000_000)],
        DebtLongtermAndShorttermCombinedAmount: [instantFact("2025-12-31", 43_537_000_000)],
      }),
    );

    expect(history).toEqual([expect.objectContaining({ fiscalYear: 2025, totalDebt: 34_241_000_000 })]);
  });

  it("still prefers LongTermDebtNoncurrent when the filer reports several debt tags", () => {
    const history = parseAnnualFundamentalsHistory(
      companyFacts({
        StockholdersEquity: [instantFact("2025-09-27", 10_000_000)],
        LongTermDebtNoncurrent: [instantFact("2025-09-27", 78_328_000_000)],
        LongTermDebt: [instantFact("2025-09-27", 90_678_000_000)],
      }),
    );

    expect(history.map((h) => h.totalDebt)).toEqual([78_328_000_000]);
  });
});
