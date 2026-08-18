import { describe, expect, it } from "vitest";
import { normalizeExchanges, normalizeFiscalYearEnd } from "../src/providers/SecEdgarProvider.js";

describe("normalizeExchanges", () => {
  it("keeps the single exchange most filers report", () => {
    expect(normalizeExchanges(["Nasdaq"])).toBe("Nasdaq");
  });

  it("joins a dual listing rather than silently picking one", () => {
    expect(normalizeExchanges(["NYSE", "CBOE"])).toBe("NYSE, CBOE");
  });

  it("returns null when EDGAR reports nothing usable", () => {
    expect(normalizeExchanges([])).toBeNull();
    expect(normalizeExchanges([""])).toBeNull();
    expect(normalizeExchanges(null)).toBeNull();
    expect(normalizeExchanges(undefined)).toBeNull();
  });
});

describe("normalizeFiscalYearEnd", () => {
  it("passes through a well-formed MMDD unchanged, for the UI to format", () => {
    expect(normalizeFiscalYearEnd("0926")).toBe("0926");
    expect(normalizeFiscalYearEnd("1231")).toBe("1231");
    expect(normalizeFiscalYearEnd("0229")).toBe("0229");
  });

  it("rejects anything that isn't a real calendar day", () => {
    expect(normalizeFiscalYearEnd("1331")).toBeNull();
    expect(normalizeFiscalYearEnd("0000")).toBeNull();
    expect(normalizeFiscalYearEnd("0230")).toBeNull();
    expect(normalizeFiscalYearEnd("0631")).toBeNull();
    expect(normalizeFiscalYearEnd("926")).toBeNull();
    expect(normalizeFiscalYearEnd("--26")).toBeNull();
    expect(normalizeFiscalYearEnd(null)).toBeNull();
    expect(normalizeFiscalYearEnd(undefined)).toBeNull();
  });
});
