import { describe, expect, it } from "vitest";
import { evaluateFormula, FormulaError, parseFormula } from "./formulaFilter";

function evalStr(formula: string, context: Record<string, number | null>): boolean {
  return evaluateFormula(parseFormula(formula), context);
}

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
