import { describe, expect, it } from "vitest";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import {
  SecEdgarProvider,
  annualFiledDates,
  parseAnnualCashFlowStatements,
} from "../src/providers/SecEdgarProvider.js";

/**
 * `filedAt` was hardcoded null on all three statement types even though every XBRL fact carries
 * `filed` and the provider already relies on it (per-period collisions resolve "later `filed`
 * wins"). Without it nothing in the app can say when a figure became public, so any historical
 * score silently uses restated numbers that were not knowable at the time.
 *
 * The rule, stated once here and in full on StatementPeriodMeta.filedAt: a row's filedAt is the
 * MAXIMUM `filed` across the facts that supplied its values, because the values are the restated
 * ones — the earliest contributing filing did not contain them, so stamping this row with that
 * earlier date would assert the numbers existed before they did.
 *
 * Live EDGAR check, 8 filers x 12 years x 3 statements = 284 rows (2026-08): zero rows where
 * filedAt precedes the true fiscal period end, zero nulls, filing lag 29-1155 days (the long tail
 * is a prior year repeated as a comparative column in a much later 10-K, which is exactly the
 * filing its stored value came from). AAPL FY2025 income = 2025-10-31, MSFT FY2026 = 2026-07-29,
 * JPM FY2025 = 2026-02-13, WMT FY2026 = 2026-03-13 — all plausible, none 2016.
 */

const FILED = "2026-02-20";

function durationFact(end: string, val: number, filed = FILED): XbrlFact {
  const start = new Date(new Date(end).getTime() - 364 * 86_400_000).toISOString().slice(0, 10);
  return { start, end, val, fy: new Date(end).getUTCFullYear(), fp: "FY", form: "10-K", filed };
}

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

const provider = new SecEdgarProvider();

type PrivateExtractors = {
  extractIncomeStatements(f: CompanyFacts, p: number, t?: string): IncomeStatement[];
  extractBalanceSheets(f: CompanyFacts, p: number, t?: string): BalanceSheet[];
};

const incomeFor = (facts: CompanyFacts, periods = 5) =>
  (provider as unknown as PrivateExtractors).extractIncomeStatements(facts, periods);
const balanceFor = (facts: CompanyFacts, periods = 5) =>
  (provider as unknown as PrivateExtractors).extractBalanceSheets(facts, periods);
const cashFlowFor = (facts: CompanyFacts, periods = 5) =>
  parseAnnualCashFlowStatements(facts, periods, "sec-edgar");

const filedByYear = (rows: { fiscalYear: number; filedAt: string | null }[]) =>
  Object.fromEntries(rows.map((r) => [r.fiscalYear, r.filedAt]));

/** Balance sheets are emitted for the fiscal years `Assets` covers, so every balance case needs one. */
const assetFacts = (...facts: XbrlFact[]) => ({ Assets: facts });

describe("SEC EDGAR — filing date capture", () => {
  it("resolves the filing date per derived fiscal year", () => {
    const facts = companyFacts({
      Revenues: [
        durationFact("2023-12-31", 300_000_000_000, "2024-02-15"),
        durationFact("2024-12-31", 320_000_000_000, "2025-02-14"),
        durationFact("2025-12-31", 340_000_000_000, "2026-02-13"),
      ],
    });

    expect(filedByYear(incomeFor(facts))).toEqual({
      2023: "2024-02-15",
      2024: "2025-02-14",
      2025: "2026-02-13",
    });
  });

  it("takes the LATEST filing across the concepts that supplied the row's values", () => {
    // Revenue came from the original 10-K, net income from a later amendment of the same period.
    // The row therefore carries a restated net income, and 2026-02-13 is the first date on which
    // every number on the row was simultaneously public.
    const facts = companyFacts({
      Revenues: [durationFact("2025-12-31", 340_000_000_000, "2026-02-13")],
      NetIncomeLoss: [
        durationFact("2025-12-31", 50_000_000_000, "2026-02-13"),
        durationFact("2025-12-31", 48_500_000_000, "2026-06-30"),
      ],
    });

    const [row] = incomeFor(facts);
    expect(row.netIncome).toBe(48_500_000_000);
    expect(row.filedAt).toBe("2026-06-30");
  });

  it("moves a restated period's date forward with the value it restated", () => {
    const original = companyFacts({
      Revenues: [durationFact("2025-12-31", 340_000_000_000, "2026-02-13")],
    });
    const restated = companyFacts({
      Revenues: [
        durationFact("2025-12-31", 340_000_000_000, "2026-02-13"),
        durationFact("2025-12-31", 331_000_000_000, "2027-02-12"),
      ],
    });

    expect(incomeFor(original)[0]).toMatchObject({ revenue: 340_000_000_000, filedAt: "2026-02-13" });
    // Not "when this period was first reported": that filing does not contain 331B.
    expect(incomeFor(restated)[0]).toMatchObject({ revenue: 331_000_000_000, filedAt: "2027-02-12" });
  });

  it("never dates a row before its own fiscal period end", () => {
    // A `filed` preceding the period it reports is impossible for a real filing, and accepting it
    // would produce exactly the look-ahead this field exists to prevent. The corrupt fact's value
    // is untouched; only its date is refused, and the row falls back to a sound contributor.
    const facts = companyFacts({
      Revenues: [durationFact("2025-12-31", 340_000_000_000, "2024-01-05")],
      NetIncomeLoss: [durationFact("2025-12-31", 50_000_000_000, "2026-02-13")],
    });

    const [row] = incomeFor(facts);
    expect(row.revenue).toBe(340_000_000_000);
    expect(row.filedAt).toBe("2026-02-13");
    expect(row.filedAt! >= "2025-12-31").toBe(true);
  });

  it("yields null rather than a fabricated date when every contributing filing date is unusable", () => {
    const cases: (string | undefined)[] = [undefined, "", "not-a-date", "20260220", "2026-13-45", "2024-01-05"];
    for (const filed of cases) {
      const facts = companyFacts({
        Revenues: [{ ...durationFact("2025-12-31", 340_000_000_000), filed: filed as string }],
      });
      const [row] = incomeFor(facts);
      expect(row.revenue, `filed=${String(filed)}`).toBe(340_000_000_000);
      expect(row.filedAt, `filed=${String(filed)}`).toBeNull();
    }
  });

  it("does not let a valid earlier date stand in for the winning fact's unusable one", () => {
    // Two annual period ends inside one calendar year (a fiscal-year-end change): the later `end`
    // supplies the year's value, so the year's date must be that fact's or nothing.
    const facts = companyFacts({
      Revenues: [
        durationFact("2025-03-31", 300_000_000_000, "2025-05-20"),
        { ...durationFact("2025-12-31", 340_000_000_000), filed: "" },
      ],
    });

    const [row] = incomeFor(facts);
    expect(row.revenue).toBe(340_000_000_000);
    expect(row.filedAt).toBeNull();
  });

  it("inherits annualFactsByEnd's selection rules — 10-K only, annual durations, later-filed-wins", () => {
    const facts = companyFacts({
      Revenues: [
        durationFact("2025-12-31", 340_000_000_000, "2026-02-13"),
        // A 10-Q restating the same period end, filed later: not an annual fact, so neither its
        // value nor its date may be used.
        { ...durationFact("2025-12-31", 999, "2026-05-01"), form: "10-Q" },
        // A quarterly duration ending on the same date, filed later.
        { start: "2025-10-01", end: "2025-12-31", val: 88, fy: 2025, fp: "Q4", form: "10-K", filed: "2026-09-01" },
      ],
    });

    expect(incomeFor(facts)[0]).toMatchObject({ revenue: 340_000_000_000, filedAt: "2026-02-13" });
  });

  it("ignores a later-filed tag whose value strict precedence rejected", () => {
    // TOTAL_DEBT_TAGS resolves per period by precedence, so a fresher filing of a lower-precedence
    // basis contributes nothing to the row — including its date.
    const facts = companyFacts({
      ...assetFacts(instantFact("2025-12-31", 500_000_000_000, "2026-02-13")),
      StockholdersEquity: [instantFact("2025-12-31", 60_000_000_000, "2026-02-13")],
      LongTermDebtNoncurrent: [instantFact("2025-12-31", 78_328_000_000, "2026-02-13")],
      LongTermDebt: [instantFact("2025-12-31", 90_678_000_000, "2026-08-01")],
    });

    expect(balanceFor(facts)[0]).toMatchObject({ totalDebt: 78_328_000_000, filedAt: "2026-02-13" });
  });

  it("dates cash flow rows independently of the other statements", () => {
    const facts = companyFacts({
      NetCashProvidedByUsedInOperatingActivities: [durationFact("2025-12-31", 100_000_000_000, "2026-02-13")],
      PaymentsToAcquirePropertyPlantAndEquipment: [durationFact("2025-12-31", 12_000_000_000, "2026-07-15")],
    });

    expect(cashFlowFor(facts)[0]).toMatchObject({
      operatingCashFlow: 100_000_000_000,
      capitalExpenditures: -12_000_000_000,
      filedAt: "2026-07-15",
    });
  });

  it("dates a fiscal year on or after its true period end, for a non-December filer", () => {
    // Apple's real FY2025: period ends 2025-09-27, 10-K filed 2025-10-31. `periodEnd` on the row
    // is the provider's synthetic `${fy}-12-31`, so filedAt < periodEnd is expected here and is
    // NOT the invariant — the invariant is against the true fiscal period end.
    const facts = companyFacts({
      RevenueFromContractWithCustomerExcludingAssessedTax: [
        durationFact("2025-09-27", 416_161_000_000, "2025-10-31"),
      ],
      ...assetFacts(instantFact("2025-09-27", 331_000_000_000, "2025-10-31")),
      NetCashProvidedByUsedInOperatingActivities: [durationFact("2025-09-27", 118_254_000_000, "2025-10-31")],
    });

    for (const row of [incomeFor(facts)[0], balanceFor(facts)[0], cashFlowFor(facts)[0]] as {
      fiscalYear: number;
      periodEnd: string;
      filedAt: string | null;
    }[]) {
      expect(row.filedAt).toBe("2025-10-31");
      expect(row.filedAt! >= "2025-09-27").toBe(true);
      expect(row.periodEnd).toBe("2025-12-31");
    }
  });

  describe("annualFiledDates", () => {
    it("returns one date per derived fiscal year, later filing winning a repeated period end", () => {
      const facts = companyFacts({
        Revenues: [
          durationFact("2024-12-31", 320_000_000_000, "2025-02-14"),
          durationFact("2024-12-31", 318_000_000_000, "2026-02-13"),
          durationFact("2025-12-31", 340_000_000_000, "2026-02-13"),
        ],
      });

      expect([...annualFiledDates(facts, ["Revenues"])]).toEqual([
        [2024, "2026-02-13"],
        [2025, "2026-02-13"],
      ]);
    });

    it("is empty for a null companyfacts response and for tags with no annual facts", () => {
      expect([...annualFiledDates(null, ["Revenues"])]).toEqual([]);
      expect([...annualFiledDates(companyFacts({ Revenues: [] }), ["Revenues"])]).toEqual([]);
    });
  });

  it("changes no statement VALUE — frozen against the pre-filedAt implementation", () => {
    // Captured from the provider as it was immediately before filedAt was populated (git HEAD
    // a5ca06c), on this same fixture. filedAt is stripped before comparison; nothing else may move.
    const facts = companyFacts({
      Revenues: [
        durationFact("2023-12-31", 300_000_000_000, "2024-02-15"),
        durationFact("2024-12-31", 320_000_000_000, "2025-02-14"),
        durationFact("2025-12-31", 340_000_000_000, "2026-02-13"),
        durationFact("2025-12-31", 341_000_000_000, "2027-02-12"),
      ],
      CostOfRevenue: [
        durationFact("2024-12-31", 180_000_000_000, "2025-02-14"),
        durationFact("2025-12-31", 190_000_000_000, "2026-02-13"),
      ],
      NetIncomeLoss: [
        durationFact("2023-12-31", 45_000_000_000, "2024-02-15"),
        durationFact("2024-12-31", 48_000_000_000, "2025-02-14"),
      ],
      ProfitLoss: [durationFact("2025-12-31", 52_000_000_000, "2026-02-13")],
      OperatingIncomeLoss: [durationFact("2025-12-31", 65_000_000_000, "2026-02-13")],
      IncomeTaxExpenseBenefit: [durationFact("2025-12-31", 14_000_000_000, "2026-02-13")],
      EarningsPerShareDiluted: [durationFact("2025-12-31", 6.11, "2026-02-13")],
      Assets: [
        instantFact("2024-12-31", 480_000_000_000, "2025-02-14"),
        instantFact("2025-12-31", 500_000_000_000, "2026-02-13"),
      ],
      StockholdersEquity: [
        instantFact("2024-12-31", 58_000_000_000, "2025-02-14"),
        instantFact("2025-12-31", 60_000_000_000, "2026-08-01"),
      ],
      Goodwill: [instantFact("2025-12-31", 8_000_000_000, "2026-02-13")],
      LongTermDebtNoncurrent: [instantFact("2025-12-31", 78_328_000_000, "2026-02-13")],
      LongTermDebt: [instantFact("2025-12-31", 90_678_000_000, "2026-09-30")],
      NetCashProvidedByUsedInOperatingActivities: [
        durationFact("2024-12-31", 95_000_000_000, "2025-02-14"),
        durationFact("2025-12-31", 100_000_000_000, "2026-02-13"),
      ],
      PaymentsToAcquirePropertyPlantAndEquipment: [durationFact("2025-12-31", 12_000_000_000, "2026-02-13")],
      PaymentsForRepurchaseOfCommonStock: [durationFact("2025-12-31", 20_000_000_000, "2026-02-13")],
      ShareBasedCompensation: [durationFact("2025-12-31", 11_000_000_000, "2026-02-13")],
      AllocatedShareBasedCompensationExpense: [durationFact("2025-12-31", 12_500_000_000, "2026-10-01")],
    });

    const withoutFiledAt = <T extends { filedAt: string | null }>(rows: T[]) =>
      rows.map(({ filedAt: _filedAt, ...rest }) => rest);

    expect(withoutFiledAt(incomeFor(facts))).toEqual(FROZEN_INCOME);
    expect(withoutFiledAt(balanceFor(facts))).toEqual(FROZEN_BALANCE);
    expect(withoutFiledAt(cashFlowFor(facts))).toEqual(FROZEN_CASH_FLOW);

    // The dates themselves, so a change to the max rule shows up as a diff rather than silently.
    expect(filedByYear(incomeFor(facts))).toEqual({ 2023: "2024-02-15", 2024: "2025-02-14", 2025: "2027-02-12" });
    expect(filedByYear(balanceFor(facts))).toEqual({ 2024: "2025-02-14", 2025: "2026-08-01" });
    expect(filedByYear(cashFlowFor(facts))).toEqual({ 2024: "2025-02-14", 2025: "2026-02-13" });
  });
});

const FROZEN_INCOME: Omit<IncomeStatement, "filedAt">[] = [
  {
      periodKey: "2025-FY",
      periodType: "FY",
      fiscalYear: 2025,
      periodEnd: "2025-12-31",
      sourceProvider: "sec_edgar",
      revenue: 341_000_000_000,
      costOfRevenue: 190_000_000_000,
      grossProfit: 151_000_000_000,
      researchAndDevelopment: null,
      operatingIncome: 65_000_000_000,
      ebit: 65_000_000_000,
      ebitda: null,
      interestExpense: null,
      pretaxIncome: null,
      incomeTaxExpense: 14_000_000_000,
      netIncome: 52_000_000_000,
      eps: null,
      epsDiluted: 6.11,
      sharesOutstandingDiluted: null,
  },
  {
      periodKey: "2024-FY",
      periodType: "FY",
      fiscalYear: 2024,
      periodEnd: "2024-12-31",
      sourceProvider: "sec_edgar",
      revenue: 320_000_000_000,
      costOfRevenue: 180_000_000_000,
      grossProfit: 140_000_000_000,
      researchAndDevelopment: null,
      operatingIncome: null,
      ebit: null,
      ebitda: null,
      interestExpense: null,
      pretaxIncome: null,
      incomeTaxExpense: null,
      netIncome: 48_000_000_000,
      eps: null,
      epsDiluted: null,
      sharesOutstandingDiluted: null,
  },
  {
      periodKey: "2023-FY",
      periodType: "FY",
      fiscalYear: 2023,
      periodEnd: "2023-12-31",
      sourceProvider: "sec_edgar",
      revenue: 300_000_000_000,
      costOfRevenue: null,
      grossProfit: null,
      researchAndDevelopment: null,
      operatingIncome: null,
      ebit: null,
      ebitda: null,
      interestExpense: null,
      pretaxIncome: null,
      incomeTaxExpense: null,
      netIncome: 45_000_000_000,
      eps: null,
      epsDiluted: null,
      sharesOutstandingDiluted: null,
  },
];
const FROZEN_BALANCE: Omit<BalanceSheet, "filedAt">[] = [
  {
      periodKey: "2025-FY",
      periodType: "FY",
      fiscalYear: 2025,
      periodEnd: "2025-12-31",
      sourceProvider: "sec_edgar",
      cashAndEquivalents: null,
      shortTermInvestments: null,
      receivables: null,
      inventory: null,
      totalCurrentAssets: null,
      totalAssets: 500_000_000_000,
      intangibleAssets: null,
      goodwill: 8_000_000_000,
      totalCurrentLiabilities: null,
      accountsPayable: null,
      shortTermDebt: null,
      longTermDebt: 78_328_000_000,
      totalDebt: 78_328_000_000,
      totalLiabilities: null,
      totalEquity: 60_000_000_000,
      tangibleBookValue: 52_000_000_000,
      retainedEarnings: null,
  },
  {
      periodKey: "2024-FY",
      periodType: "FY",
      fiscalYear: 2024,
      periodEnd: "2024-12-31",
      sourceProvider: "sec_edgar",
      cashAndEquivalents: null,
      shortTermInvestments: null,
      receivables: null,
      inventory: null,
      totalCurrentAssets: null,
      totalAssets: 480_000_000_000,
      intangibleAssets: null,
      goodwill: null,
      totalCurrentLiabilities: null,
      accountsPayable: null,
      shortTermDebt: null,
      longTermDebt: null,
      totalDebt: null,
      totalLiabilities: null,
      totalEquity: 58_000_000_000,
      tangibleBookValue: 58_000_000_000,
      retainedEarnings: null,
  },
];
const FROZEN_CASH_FLOW: Omit<CashFlowStatement, "filedAt">[] = [
  {
      periodKey: "2025-FY",
      periodType: "FY",
      fiscalYear: 2025,
      periodEnd: "2025-12-31",
      sourceProvider: "sec-edgar",
      operatingCashFlow: 100_000_000_000,
      capitalExpenditures: -12_000_000_000,
      freeCashFlow: 88_000_000_000,
      dividendsPaid: null,
      stockBuybacks: -20_000_000_000,
      stockIssuance: null,
      netDebtIssuance: null,
      depreciationAndAmortization: null,
      shareBasedCompensation: 11_000_000_000,
  },
  {
      periodKey: "2024-FY",
      periodType: "FY",
      fiscalYear: 2024,
      periodEnd: "2024-12-31",
      sourceProvider: "sec-edgar",
      operatingCashFlow: 95_000_000_000,
      capitalExpenditures: null,
      freeCashFlow: null,
      dividendsPaid: null,
      stockBuybacks: null,
      stockIssuance: null,
      netDebtIssuance: null,
      depreciationAndAmortization: null,
      shareBasedCompensation: null,
  },
];
