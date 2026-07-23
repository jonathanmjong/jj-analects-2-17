/**
 * SEC EDGAR's `stateOrCountry` address field conflates two different code
 * spaces: two-letter US state/territory codes for domestic filers, and a
 * separate (often numeric-prefixed, e.g. "D0" for Bermuda) code space for
 * foreign locations. `stateOrCountryDescription` happens to just echo the
 * code back for domestic addresses but spells out the real country name for
 * foreign ones — this set lets us tell which case we're in.
 */
export const US_STATE_AND_TERRITORY_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY", "PR", "VI", "GU", "AS", "MP", "FM", "MH", "PW", "AE", "AA", "AP",
]);

/**
 * Resolves SEC's stateOrCountry (+ echoed/spelled-out description) into a
 * real country name. Pulled out as a pure function so the domestic-vs-
 * foreign branching is unit-testable without mocking HTTP.
 */
export function resolveCountry(stateOrCountry: string | null | undefined, stateOrCountryDescription: string | null | undefined): string | null {
  if (!stateOrCountry) return null;
  if (US_STATE_AND_TERRITORY_CODES.has(stateOrCountry)) return "United States";
  return stateOrCountryDescription ?? stateOrCountry;
}
