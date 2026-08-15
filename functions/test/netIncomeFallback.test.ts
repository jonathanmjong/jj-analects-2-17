import { describe, expect, it } from "vitest";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import { NET_INCOME_TAGS, SecEdgarProvider, parseAnnualFundamentalsHistory } from "../src/providers/SecEdgarProvider.js";

/**
 * Net income was resolved from the single tag `NetIncomeLoss`, leaving 134 of 1,344 companies with
 * a null latest-year figure — which silently nulls P/E, every margin, growth CAGRs, F-Score and the
 * FFO metrics. Verified live on EDGAR:
 *   - SPG (CIK 0001063761) reports NO `NetIncomeLoss` at all, only
 *     `NetIncomeLossAvailableToCommonStockholdersBasic` and `ProfitLoss`.
 *   - EXC / VTR / ETR / WEC report `NetIncomeLoss` for OLD years and stop — a mid-history dropoff,
 *     not a company that never used the tag.
 *   - PLD / DUK / D / KIM / PSA / DLR report ALL THREE tags for the SAME period end at three
 *     different values (parent-only vs after-preferred vs NCI-inclusive).
 * That last group is why this cannot be a plain tag merge: those companies are already correct, and
 * a merge resolving ties by `filed` (identical within one filing) would silently swap their
 * accounting basis. Precedence has to be strict and evaluated per fiscal period.
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

/** Revenue selects the fiscal years income statements are emitted for, so every case needs one. */
const revenueFacts = (...ends: string[]) => ({
  Revenues: ends.map((end, i) => durationFact(end, 5_000_000_000 + i)),
});

const provider = new SecEdgarProvider();

/** extractIncomeStatements is private; getCompanyBundle/getIncomeStatements are the HTTP entry points. */
const incomeFor = (facts: CompanyFacts, periods = 5) =>
  (provider as unknown as {
    extractIncomeStatements(f: CompanyFacts, p: number, t?: string): { fiscalYear: number; netIncome: number | null }[];
  }).extractIncomeStatements(facts, periods);

const netIncomeByYear = (facts: CompanyFacts, periods = 5) =>
  Object.fromEntries(incomeFor(facts, periods).map((s) => [s.fiscalYear, s.netIncome]));

describe("SEC EDGAR — net income tag precedence", () => {
  it("documents its precedence in one place", () => {
    expect(NET_INCOME_TAGS).toEqual([
      "NetIncomeLoss",
      "NetIncomeLossAvailableToCommonStockholdersBasic",
      "ProfitLoss",
    ]);
  });

  it("keeps NetIncomeLoss when fallbacks are present for the same period at the same filed date", () => {
    // THE regression this guards: every company that is currently correct reports NetIncomeLoss,
    // and most large filers with noncontrolling interests report the other two tags alongside it,
    // in the same filing (so `filed` cannot break the tie). The parent-only basis must survive.
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLoss: [durationFact("2025-12-31", 3_328_231_000)],
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 3_322_349_000)],
        ProfitLoss: [durationFact("2025-12-31", 3_565_299_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_328_231_000 });
  });

  it("is not sensitive to which tag appears first in the response object", () => {
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        ProfitLoss: [durationFact("2025-12-31", 3_565_299_000)],
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 3_322_349_000)],
        NetIncomeLoss: [durationFact("2025-12-31", 3_328_231_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_328_231_000 });
  });

  it("does not let a later-filed fallback restatement displace the primary for that period", () => {
    // Within ONE tag, later-filed wins (annualFactsByEnd's rule, unchanged). ACROSS tags it must
    // not: a fresher filing of a different basis is still a different basis.
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLoss: [durationFact("2025-12-31", 3_328_231_000, "2026-02-20")],
        ProfitLoss: [durationFact("2025-12-31", 3_565_299_000, "2026-08-01")],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_328_231_000 });
  });

  it("still lets a later-filed restatement of the primary tag itself win", () => {
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLoss: [
          durationFact("2025-12-31", 3_328_231_000, "2026-02-20"),
          durationFact("2025-12-31", 3_300_000_000, "2026-08-01"),
        ],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_300_000_000 });
  });

  it("falls back to the after-preferred figure, not the NCI-inclusive one (the SPG case)", () => {
    // SPG reports no NetIncomeLoss whatsoever. Market cap prices common equity, so the
    // after-preferred-dividends figure is the right numerator basis; ProfitLoss overstates it.
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 3_048_269_000)],
        ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_048_269_000 });
  });

  it("falls through to ProfitLoss only when both higher-precedence tags are absent", () => {
    const byYear = netIncomeByYear(
      companyFacts({ ...revenueFacts("2025-12-31"), ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)] }),
    );

    expect(byYear).toEqual({ 2025: 3_539_882_000 });
  });

  it("resolves each fiscal period independently, with no cross-year basis bleed (the EXC/VTR case)", () => {
    // A filer that used NetIncomeLoss for older years and stopped: the old years must KEEP the
    // parent-only basis rather than being restated onto whatever covers the latest year.
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"),
        NetIncomeLoss: [durationFact("2022-12-31", 1_000), durationFact("2023-12-31", 1_100)],
        NetIncomeLossAvailableToCommonStockholdersBasic: [
          durationFact("2022-12-31", 900),
          durationFact("2023-12-31", 950),
          durationFact("2024-12-31", 1_200),
        ],
        ProfitLoss: [
          durationFact("2022-12-31", 1_500),
          durationFact("2023-12-31", 1_600),
          durationFact("2024-12-31", 1_700),
          durationFact("2025-12-31", 1_800),
        ],
      }),
    );

    expect(byYear).toEqual({ 2025: 1_800, 2024: 1_200, 2023: 1_100, 2022: 1_000 });
  });

  it("leaves a year null when no tag has a qualifying fact for it", () => {
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2024-12-31", "2025-12-31"),
        ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_539_882_000, 2024: null });
  });

  it("rejects a fallback fact that fails the existing selection rules", () => {
    // Non-10-K forms and quarterly-length durations are filtered per tag, exactly as before —
    // widening the tag set must not widen what counts as an annual fact.
    const quarterly: XbrlFact = {
      start: "2025-10-01", end: "2025-12-31", val: 111, fy: 2025, fp: "Q4", form: "10-K", filed: FILED,
    };
    const tenQ: XbrlFact = { ...durationFact("2025-12-31", 999), form: "10-Q" };

    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLossAvailableToCommonStockholdersBasic: [quarterly, tenQ],
        ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)],
      }),
    );

    // The rejected facts must not count as "primary present" either — precedence falls through.
    expect(byYear).toEqual({ 2025: 3_539_882_000 });
  });

  it("does not let a disqualified primary fact block the fallback", () => {
    const tenQ: XbrlFact = { ...durationFact("2025-12-31", 999), form: "10-Q" };
    const byYear = netIncomeByYear(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        NetIncomeLoss: [tenQ],
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 3_048_269_000)],
      }),
    );

    expect(byYear).toEqual({ 2025: 3_048_269_000 });
  });

  it("leaves the rest of the income statement untouched", () => {
    const [statement] = incomeFor(
      companyFacts({
        ...revenueFacts("2025-12-31"),
        GrossProfit: [durationFact("2025-12-31", 2_000_000_000)],
        OperatingIncomeLoss: [durationFact("2025-12-31", 1_500_000_000)],
        IncomeTaxExpenseBenefit: [durationFact("2025-12-31", 300_000_000)],
        ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)],
      }),
    );

    expect(statement).toMatchObject({
      fiscalYear: 2025,
      periodKey: "2025-FY",
      revenue: 5_000_000_000,
      grossProfit: 2_000_000_000,
      operatingIncome: 1_500_000_000,
      ebit: 1_500_000_000,
      incomeTaxExpense: 300_000_000,
      netIncome: 3_539_882_000,
    });
  });
});

describe("SEC EDGAR — net income fallback in the valuation-history parse", () => {
  it("applies the same precedence, and derives a period end for a filer with no NetIncomeLoss", () => {
    // parseAnnualFundamentalsHistory feeds the self-vs-history valuation multiples; before the fix
    // an SPG-shaped filer's netIncome was null there too, and a filer reporting ONLY ProfitLoss had
    // no income-statement tag in the periodEnds derivation at all.
    const history = parseAnnualFundamentalsHistory(
      companyFacts({
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 3_048_269_000)],
        ProfitLoss: [durationFact("2025-12-31", 3_539_882_000)],
        StockholdersEquity: [{ end: "2025-12-31", val: 10_000_000, fy: 2025, fp: "FY", form: "10-K", filed: FILED }],
      }),
    );

    expect(history).toEqual([
      expect.objectContaining({ fiscalYear: 2025, periodEnd: "2025-12-31", netIncome: 3_048_269_000 }),
    ]);
  });

  it("still prefers NetIncomeLoss when the filer reports all three", () => {
    const history = parseAnnualFundamentalsHistory(
      companyFacts({
        NetIncomeLoss: [durationFact("2025-12-31", 4_968_000_000)],
        NetIncomeLossAvailableToCommonStockholdersBasic: [durationFact("2025-12-31", 4_912_000_000)],
        ProfitLoss: [durationFact("2025-12-31", 5_071_000_000)],
      }),
    );

    expect(history.map((h) => h.netIncome)).toEqual([4_968_000_000]);
  });
});
