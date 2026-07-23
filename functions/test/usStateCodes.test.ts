import { describe, expect, it } from "vitest";
import { resolveCountry } from "../src/providers/usStateCodes.js";

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
