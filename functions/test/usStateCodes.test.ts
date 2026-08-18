import { describe, expect, it } from "vitest";
import { formatHeadquarters, resolveCountry } from "../src/providers/usStateCodes.js";

describe("resolveCountry", () => {
  it("resolves a US state code to 'United States'", () => {
    expect(resolveCountry("CA", "CA")).toBe("United States");
    expect(resolveCountry("TX", "TX")).toBe("United States");
  });

  it("uses the spelled-out description for foreign locations", () => {
    expect(resolveCountry("D0", "Bermuda")).toBe("Bermuda");
    expect(resolveCountry("L2", "Ireland")).toBe("Ireland");
  });

  it("falls back to the raw code if no description is present", () => {
    expect(resolveCountry("D0", null)).toBe("D0");
  });

  it("returns null when there's no address data at all", () => {
    expect(resolveCountry(null, null)).toBeNull();
    expect(resolveCountry(undefined, undefined)).toBeNull();
  });
});

describe("formatHeadquarters", () => {
  it("pairs a title-cased city with the state code for a domestic filer", () => {
    expect(formatHeadquarters("CUPERTINO", "CA", "CA")).toBe("Cupertino, CA");
    expect(formatHeadquarters("NEW YORK", "NY", "NY")).toBe("New York, NY");
  });

  it("uses the spelled-out country for a foreign address rather than the opaque code", () => {
    expect(formatHeadquarters("HAMILTON", "D0", "Bermuda")).toBe("Hamilton, Bermuda");
    expect(formatHeadquarters("DUBLIN", "L2", null)).toBe("Dublin, L2");
  });

  it("leaves an already mixed-case city alone", () => {
    expect(formatHeadquarters("McLean", "VA", "VA")).toBe("McLean, VA");
  });

  it("title-cases across hyphens and apostrophes", () => {
    expect(formatHeadquarters("WINSTON-SALEM", "NC", "NC")).toBe("Winston-Salem, NC");
    expect(formatHeadquarters("COEUR D'ALENE", "ID", "ID")).toBe("Coeur D'Alene, ID");
  });

  it("degrades to whichever half exists", () => {
    expect(formatHeadquarters(null, "CA", "CA")).toBe("CA");
    expect(formatHeadquarters("  ", "D0", "Bermuda")).toBe("Bermuda");
    expect(formatHeadquarters("CUPERTINO", null, null)).toBe("Cupertino");
    expect(formatHeadquarters(null, null, null)).toBeNull();
  });
});
