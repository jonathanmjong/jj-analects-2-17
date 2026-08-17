import { describe, expect, it } from "vitest";
import { CIK_OVERRIDES } from "../src/providers/SecEdgarProvider.js";

describe("CIK overrides", () => {
  it("maps XOM to the operating company that actually files", () => {
    // SEC's company_tickers.json points XOM at CIK 2115436 (ExxonMobil Holdings
    // Corp), which has filed no 10-K and returns zero annual facts. Verified
    // 2026-08-16: CIK 34088 has 45 years of Revenues and a 10-K filed 2026-02-18.
    expect(CIK_OVERRIDES.XOM).toBe("0000034088");
  });

  it("uses zero-padded 10-digit CIKs, the form every EDGAR endpoint expects", () => {
    for (const [ticker, cik] of Object.entries(CIK_OVERRIDES)) {
      expect(cik, ticker).toMatch(/^\d{10}$/);
    }
  });

  it("stays a short curated list — name-similarity guessing would mis-attach fundamentals", () => {
    expect(Object.keys(CIK_OVERRIDES).length).toBeLessThanOrEqual(25);
  });
});
