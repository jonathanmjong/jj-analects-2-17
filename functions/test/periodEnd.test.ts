import { describe, expect, it } from "vitest";
import { parseAnnualCashFlowStatements, type CompanyFacts } from "../src/providers/SecEdgarProvider.js";

/** One annual 10-K fact for a fiscal year ending on `end`. */
const fact = (start: string, end: string, val: number, filed: string) => ({
  start, end, val, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed,
});

function facts(tag: string, rows: ReturnType<typeof fact>[]): CompanyFacts {
  return { facts: { "us-gaap": { [tag]: { units: { USD: rows } } } } } as CompanyFacts;
}

describe("statement periodEnd", () => {
  it("uses the filer's real period end, not a fabricated December 31", () => {
    // Apple's FY2025 closed 2025-09-27. This was stored as 2025-12-31 for every
    // non-December filer — 28% of the universe — an error of up to 11 months.
    const out = parseAnnualCashFlowStatements(
      facts("NetCashProvidedByUsedInOperatingActivities", [fact("2024-09-29", "2025-09-27", 100, "2025-10-31")]),
      5,
      "sec_edgar",
    );
    expect(out[0].periodEnd).toBe("2025-09-27");
    expect(out[0].fiscalYear).toBe(2025);
  });

  it("still reports December 31 for a December filer", () => {
    const out = parseAnnualCashFlowStatements(
      facts("NetCashProvidedByUsedInOperatingActivities", [fact("2025-01-01", "2025-12-31", 100, "2026-02-13")]),
      5,
      "sec_edgar",
    );
    expect(out[0].periodEnd).toBe("2025-12-31");
  });

  it("never leaves periodEnd null, since the type promises a string", () => {
    const out = parseAnnualCashFlowStatements(
      facts("NetCashProvidedByUsedInOperatingActivities", [fact("2025-01-01", "2025-12-31", 100, "2026-02-13")]),
      5,
      "sec_edgar",
    );
    expect(typeof out[0].periodEnd).toBe("string");
    expect(out[0].periodEnd.length).toBeGreaterThan(0);
  });

  it("keeps periodEnd on or before the filing date", () => {
    const out = parseAnnualCashFlowStatements(
      facts("NetCashProvidedByUsedInOperatingActivities", [fact("2024-09-29", "2025-09-27", 100, "2025-10-31")]),
      5,
      "sec_edgar",
    );
    expect(out[0].periodEnd <= (out[0].filedAt ?? "9999")).toBe(true);
  });
});
