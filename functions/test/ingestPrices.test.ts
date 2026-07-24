import { describe, expect, it } from "vitest";
import { isPlausibleMarketCap, MAX_PLAUSIBLE_MARKET_CAP } from "../src/ingestion/ingestPrices.js";

describe("isPlausibleMarketCap", () => {
  it("accepts real-world market caps", () => {
    expect(isPlausibleMarketCap(3_000_000_000)).toBe(true); // $3B, mid-cap
    expect(isPlausibleMarketCap(3_000_000_000_000)).toBe(true); // $3T, largest real companies
  });

  it("rejects zero or negative values", () => {
    expect(isPlausibleMarketCap(0)).toBe(false);
    expect(isPlausibleMarketCap(-1)).toBe(false);
  });

  it("rejects filer XBRL scale-tagging errors observed in production", () => {
    // Cabot Corp: EntityPublicFloat off by exactly 10^6x in a real 10-K filing
    // — caught by the absolute ceiling alone, no revenue needed.
    expect(isPlausibleMarketCap(4_429_047_299_000_000)).toBe(false);
    // Champion Homes: off by exactly 10^3x across multiple years' filings.
    // $4.1T alone is under the absolute ceiling (plausible for *some*
    // company in the abstract), but is ~1,900x its real ~$2.14B revenue —
    // caught by the price-to-sales guard once revenue is known.
    expect(isPlausibleMarketCap(4_135_959_950_000, 2_140_000_000)).toBe(false);
  });

  it("draws the line at MAX_PLAUSIBLE_MARKET_CAP", () => {
    expect(isPlausibleMarketCap(MAX_PLAUSIBLE_MARKET_CAP)).toBe(true);
    expect(isPlausibleMarketCap(MAX_PLAUSIBLE_MARKET_CAP + 1)).toBe(false);
  });

  it("skips the price-to-sales check when revenue is unknown or zero", () => {
    // Pre-revenue/early-stage companies and screening passes without a
    // fetched income statement yet shouldn't be penalized for missing data.
    expect(isPlausibleMarketCap(3_000_000_000, null)).toBe(true);
    expect(isPlausibleMarketCap(3_000_000_000, 0)).toBe(true);
  });

  it("rejects an implausible price-to-sales ratio even under the absolute ceiling", () => {
    // $500B market cap against $1B revenue is a 500x P/S — clearly a data error.
    expect(isPlausibleMarketCap(500_000_000_000, 1_000_000_000)).toBe(false);
    // A generous but real 80x P/S should still pass.
    expect(isPlausibleMarketCap(80_000_000_000, 1_000_000_000)).toBe(true);
  });
});
