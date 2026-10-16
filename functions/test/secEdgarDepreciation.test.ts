import { describe, expect, it } from "vitest";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import { DEPRECIATION_AND_AMORTIZATION_TAGS, parseAnnualCashFlowStatements } from "../src/providers/SecEdgarProvider.js";

/**
 * D&A is the add-back that turns net income into (approximate) FFO, and filers do not agree on
 * which XBRL tag carries it — verified live against EDGAR, see DEPRECIATION_AND_AMORTIZATION_TAGS
 * for the full evidence (SPG/Vornado for the original two tags; JPM/Citigroup/AmEx/Crown Castle
 * and AvalonBay/Equity Residential for the two fallback tags added 2026-10). So the merge has to
 * cover all four tags AND have a deterministic winner whenever more than one is present.
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

/** Every case needs an operating-cash-flow series, since that is what selects the fiscal years. */
const OCF = { NetCashProvidedByUsedInOperatingActivities: [durationFact("2025-12-31", 2_000_000_000)] };

const dnaFor = (facts: CompanyFacts) => parseAnnualCashFlowStatements(facts, 5, "sec_edgar")[0].depreciationAndAmortization;

describe("SEC EDGAR — depreciation & amortization tag precedence", () => {
  it("prefers DepreciationDepletionAndAmortization when a filer reports both (the Vornado case)", () => {
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationDepletionAndAmortization: [durationFact("2025-12-31", 481_456_000)],
        DepreciationAndAmortization: [durationFact("2025-12-31", 462_201_000)],
      }),
    );

    expect(value).toBe(481_456_000);
  });

  it("is not sensitive to which tag appears first in the response object", () => {
    // Precedence must come from DEPRECIATION_AND_AMORTIZATION_TAGS, not from key insertion order.
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationAndAmortization: [durationFact("2025-12-31", 462_201_000)],
        DepreciationDepletionAndAmortization: [durationFact("2025-12-31", 481_456_000)],
      }),
    );

    expect(value).toBe(481_456_000);
  });

  it("falls back to DepreciationAndAmortization when it is the only tag (the SPG case)", () => {
    const value = dnaFor(
      companyFacts({ ...OCF, DepreciationAndAmortization: [durationFact("2025-12-31", 1_426_423_000)] }),
    );

    expect(value).toBe(1_426_423_000);
  });

  it("uses DepreciationDepletionAndAmortization when it is the only tag", () => {
    const value = dnaFor(
      companyFacts({ ...OCF, DepreciationDepletionAndAmortization: [durationFact("2025-12-31", 900_000_000)] }),
    );

    expect(value).toBe(900_000_000);
  });

  it("is null when the filer tags neither concept", () => {
    expect(dnaFor(companyFacts(OCF))).toBeNull();
  });

  it("is null for a year where only other cash-flow lines were reported", () => {
    const statements = parseAnnualCashFlowStatements(
      companyFacts({
        NetCashProvidedByUsedInOperatingActivities: [
          durationFact("2024-12-31", 1_800_000_000),
          durationFact("2025-12-31", 2_000_000_000),
        ],
        DepreciationAndAmortization: [durationFact("2025-12-31", 1_426_423_000)],
      }),
      5,
      "sec_edgar",
    );

    expect(statements.map((s) => [s.fiscalYear, s.depreciationAndAmortization])).toEqual([
      [2025, 1_426_423_000],
      [2024, null],
    ]);
  });

  it("ignores quarterly comparatives and non-10-K forms, like every other series here", () => {
    const quarterly: XbrlFact = { start: "2025-01-01", end: "2025-03-31", val: 111, fy: 2025, fp: "Q1", form: "10-K", filed: FILED };
    const tenQ: XbrlFact = { ...durationFact("2025-12-31", 999), form: "10-Q" };
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationAndAmortization: [quarterly, tenQ, durationFact("2025-12-31", 1_426_423_000)],
      }),
    );

    expect(value).toBe(1_426_423_000);
  });

  it("lets a later-filed restatement of either tag win over an earlier filing", () => {
    // The freshest-filing rule is annualFactsByEnd's existing behavior and applies across the
    // merged tag set — tag order only decides ties within one filing date.
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationDepletionAndAmortization: [durationFact("2025-12-31", 481_456_000, "2026-02-20")],
        DepreciationAndAmortization: [durationFact("2025-12-31", 470_000_000, "2026-08-01")],
      }),
    );

    expect(value).toBe(470_000_000);
  });

  it("leaves the rest of the cash flow statement unchanged", () => {
    const [statement] = parseAnnualCashFlowStatements(
      companyFacts({
        NetCashProvidedByUsedInOperatingActivities: [durationFact("2025-12-31", 2_000_000_000)],
        PaymentsToAcquirePropertyPlantAndEquipment: [durationFact("2025-12-31", 500_000_000)],
        PaymentsOfDividends: [durationFact("2025-12-31", 300_000_000)],
        DepreciationAndAmortization: [durationFact("2025-12-31", 1_426_423_000)],
      }),
      5,
      "sec_edgar",
    );

    expect(statement).toMatchObject({
      fiscalYear: 2025,
      periodKey: "2025-FY",
      sourceProvider: "sec_edgar",
      operatingCashFlow: 2_000_000_000,
      capitalExpenditures: -500_000_000,
      freeCashFlow: 1_500_000_000,
      dividendsPaid: -300_000_000,
      depreciationAndAmortization: 1_426_423_000,
    });
  });

  it("documents its precedence in one place", () => {
    expect(DEPRECIATION_AND_AMORTIZATION_TAGS).toEqual([
      "DepreciationDepletionAndAmortization",
      "DepreciationAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "Depreciation",
    ]);
  });

  it("falls back to DepreciationAmortizationAndAccretionNet when neither primary tag exists (the JPM/CCI case)", () => {
    // JPMorgan, Citigroup and American Express report no DepreciationDepletionAndAmortization or
    // DepreciationAndAmortization at all, only this. Crown Castle (a REIT, where this field feeds
    // approximate FFO) is the same shape.
    const value = dnaFor(
      companyFacts({ ...OCF, DepreciationAmortizationAndAccretionNet: [durationFact("2025-12-31", 863_000_000)] }),
    );

    expect(value).toBe(863_000_000);
  });

  it("falls back to Depreciation only as the last resort (the AvalonBay/Equity Residential case)", () => {
    // Both REITs report neither of the first three tags, only bare depreciation — and both are
    // apartment owners with no material intangible amortization to be missing from it.
    const value = dnaFor(companyFacts({ ...OCF, Depreciation: [durationFact("2025-12-31", 1_010_400_000)] }));

    expect(value).toBe(1_010_400_000);
  });

  it("never lets Depreciation override a reported total (the GE case)", () => {
    // GE has tagged DepreciationDepletionAndAmortization, DepreciationAmortizationAndAccretionNet
    // and bare Depreciation across its history at materially different values for the same kind of
    // period — Depreciation must stay last, not merely present.
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationDepletionAndAmortization: [durationFact("2025-12-31", 4_636_000_000)],
        DepreciationAmortizationAndAccretionNet: [durationFact("2025-12-31", 2_128_000_000)],
        Depreciation: [durationFact("2025-12-31", 9_999_000_000)],
      }),
    );

    expect(value).toBe(4_636_000_000);
  });

  it("prefers DepreciationAmortizationAndAccretionNet over bare Depreciation when both are present and nothing broader is", () => {
    const value = dnaFor(
      companyFacts({
        ...OCF,
        DepreciationAmortizationAndAccretionNet: [durationFact("2025-12-31", 2_128_000_000)],
        Depreciation: [durationFact("2025-12-31", 4_636_000_000)],
      }),
    );

    expect(value).toBe(2_128_000_000);
  });
});
