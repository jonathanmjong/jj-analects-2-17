import { describe, expect, it } from "vitest";
import {
  buildFormulaContext,
  evaluateFormula,
  FormulaError,
  normalizeFieldName,
  parseFormula,
} from "./formulaFilter";

function evalStr(formula: string, context: Record<string, number | null>, fields: string[] = []): boolean {
  return evaluateFormula(parseFormula(formula, fields), context);
}

/** Stand-in for the metricKeys list the Rankings page reads off the loaded universe export. */
const UNIVERSE_KEYS = [
  "ev_ebit",
  "fcf_yield",
  "piotroski_f_score",
  "debt_to_ebitda",
  "growth_revenue_3y",
  "pe_ttm",
  "roic",
  "avg_gross_margin_5y",
];

describe("parseFormula / evaluateFormula", () => {
  it("evaluates a simple comparison", () => {
    expect(evalStr("roic > 15%", { roic: 0.2 })).toBe(true);
    expect(evalStr("roic > 15%", { roic: 0.1 })).toBe(false);
  });

  it("supports AND / OR / NOT with precedence (AND binds tighter than OR)", () => {
    // true OR (false AND false) -> true
    expect(evalStr("roic > 10% OR peTtm < 5 AND fcfYield > 50%", { roic: 0.2, peTtm: 30, fcfYield: 0.01 })).toBe(true);
  });

  it("supports parentheses to override precedence", () => {
    expect(
      evalStr("(roic > 10% OR peTtm < 5) AND fcfYield > 50%", { roic: 0.2, peTtm: 30, fcfYield: 0.01 }),
    ).toBe(false);
  });

  it("supports NOT", () => {
    expect(evalStr("NOT roic > 15%", { roic: 0.1 })).toBe(true);
  });

  it("parses B/M suffixes for market cap comparisons", () => {
    expect(evalStr("marketCap > 10B", { marketcap: 15_000_000_000 })).toBe(true);
    expect(evalStr("marketCap > 10B", { marketcap: 5_000_000_000 })).toBe(false);
    expect(evalStr("marketCap < 500M", { marketcap: 100_000_000 })).toBe(true);
  });

  it("treats a missing field as failing the raw comparison (standard boolean algebra applies on top, so NOT inverts it like any other false)", () => {
    expect(evalStr("roic > 0%", { roic: null })).toBe(false);
    expect(evalStr("NOT roic > 0%", { roic: null })).toBe(true);
  });

  it("is case-insensitive on field names and operators", () => {
    expect(evalStr("ROIC > 10% and PETTM < 20", { roic: 0.15, pettm: 15 })).toBe(true);
  });

  it("throws FormulaError on unknown fields", () => {
    expect(() => parseFormula("bogusField > 5")).toThrow(FormulaError);
  });

  it("throws FormulaError on malformed syntax", () => {
    expect(() => parseFormula("roic >")).toThrow(FormulaError);
    expect(() => parseFormula("roic 15")).toThrow(FormulaError);
    expect(() => parseFormula("(roic > 5")).toThrow(FormulaError);
  });

  it("throws FormulaError on empty input", () => {
    expect(() => parseFormula("   ")).toThrow(FormulaError);
  });
});

describe("registry metric fields", () => {
  it("resolves any metric key passed in from the loaded universe", () => {
    expect(evalStr("ev_ebit < 8", { evebit: 6 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("piotroski_f_score >= 7", { piotroskifscore: 8 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("piotroski_f_score >= 7", { piotroskifscore: 6 }, UNIVERSE_KEYS)).toBe(false);
    expect(evalStr("growth_revenue_3y > 10%", { growthrevenue3y: 0.14 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("debt_to_ebitda < 3 AND fcf_yield > 5%", { debttoebitda: 1.2, fcfyield: 0.08 }, UNIVERSE_KEYS)).toBe(true);
  });

  it("matches metric keys case-insensitively and with or without underscores", () => {
    expect(evalStr("EV_EBIT < 8", { evebit: 6 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("evEbit < 8", { evebit: 6 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("Avg_Gross_Margin_5y > 30%", { avggrossmargin5y: 0.42 }, UNIVERSE_KEYS)).toBe(true);
  });

  it("keeps the legacy aliases addressable alongside the registry keys they duplicate", () => {
    // peTtm (alias) and pe_ttm (registry key) are the same field, not two.
    expect(normalizeFieldName("peTtm")).toBe(normalizeFieldName("pe_ttm"));
    expect(evalStr("peTtm < 20", { pettm: 12 }, UNIVERSE_KEYS)).toBe(true);
    expect(evalStr("pe_ttm < 20", { pettm: 12 }, UNIVERSE_KEYS)).toBe(true);
    // marketCap/overallScore aren't registry metrics and stay available with no universe loaded.
    expect(evalStr("marketCap > 10B AND overallScore > 70", { marketcap: 2e10, overallscore: 80 })).toBe(true);
  });

  it("still rejects an unknown field, and names near matches when it can", () => {
    expect(() => parseFormula("bogusField > 5", UNIVERSE_KEYS)).toThrow(FormulaError);
    expect(() => parseFormula("ev_ebit > 5")).toThrow(FormulaError); // not in the default alias-only set
    expect(() => parseFormula("fcf > 5%", UNIVERSE_KEYS)).toThrow(/Did you mean: fcfyield/);
  });

  it("applies unchanged null semantics to metric fields", () => {
    expect(evalStr("ev_ebit < 8", { evebit: null }, UNIVERSE_KEYS)).toBe(false);
    expect(evalStr("ev_ebit < 8", {}, UNIVERSE_KEYS)).toBe(false);
    expect(evalStr("NOT ev_ebit < 8", { evebit: null }, UNIVERSE_KEYS)).toBe(true);
  });
});

describe("buildFormulaContext", () => {
  it("normalizes registry keys and layers the non-metric fields on top", () => {
    const context = buildFormulaContext(
      { pe_ttm: 12, ev_ebit: 7, growth_revenue_3y: 0.2 },
      { marketcap: 5e9, overallscore: 81 },
    );
    expect(context).toMatchObject({ pettm: 12, evebit: 7, growthrevenue3y: 0.2, marketcap: 5e9, overallscore: 81 });
  });

  it("does not let a null alias blank out the metric value it collides with", () => {
    const context = buildFormulaContext({ roic: 0.18 }, { roic: null });
    expect(context.roic).toBe(0.18);
  });

  it("prefers the alias value when it has one", () => {
    const context = buildFormulaContext({ roic: 0.18 }, { roic: 0.21 });
    expect(context.roic).toBe(0.21);
  });

  it("tolerates a missing metric record", () => {
    expect(buildFormulaContext(undefined, { marketcap: 1e9 })).toEqual({ marketcap: 1e9 });
  });
});
