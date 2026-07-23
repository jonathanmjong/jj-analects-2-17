import { describe, expect, it } from "vitest";
import { sectorFromSicCode } from "../src/providers/sicSectorMap.js";

describe("sectorFromSicCode", () => {
  it("maps pharma SIC codes to Healthcare, not the broader Chemicals/Materials range that contains them", () => {
    expect(sectorFromSicCode(2834)).toBe("Healthcare");
    expect(sectorFromSicCode(2836)).toBe("Healthcare");
  });

  it("maps computer equipment to Technology, not the broader Industrial Machinery range", () => {
    expect(sectorFromSicCode(3571)).toBe("Technology");
  });

  it("maps REITs (6798) to Real Estate, not the broader Financials holding-office range", () => {
    expect(sectorFromSicCode(6798)).toBe("Real Estate");
  });

  it("still maps the broader chemicals range to Materials outside the pharma carve-out", () => {
    expect(sectorFromSicCode(2810)).toBe("Materials");
  });

  it("returns null for unknown/missing codes", () => {
    expect(sectorFromSicCode(null)).toBeNull();
    expect(sectorFromSicCode(99999)).toBeNull();
  });
});
