import { describe, expect, it } from "vitest";
import type { CompanyFacts, XbrlFact } from "../src/providers/SecEdgarProvider.js";
import { DEPRECIATION_AND_AMORTIZATION_TAGS, parseAnnualCashFlowStatements } from "../src/providers/SecEdgarProvider.js";

/**
 * D&A is the add-back that turns net income into (approximate) FFO, and REIT filers do not agree
 * on which XBRL tag carries it — verified live against EDGAR:
 *   - SPG (CIK 0001063761) reports only `DepreciationAndAmortization`;
 *     `DepreciationDepletionAndAmortization` 404s for that filer.
 *   - Vornado (CIK 0000899689) reports BOTH, at different values.
 * So the merge has to cover both tags AND have a deterministic winner when both are present.
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
    ]);
  });
});
