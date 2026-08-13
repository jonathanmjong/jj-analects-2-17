import { describe, expect, it } from "vitest";
// Imported from source rather than the @proverbs/shared entry point so the suite does not
// depend on shared/dist having been rebuilt since strategies.ts was added.
import {
  evaluateAllStrategies,
  evaluateStrategy,
  MARKET_CAP_INPUT_KEY,
  STRATEGIES,
  STRATEGY_BY_KEY,
  type StrategyDefinition,
  type StrategyInputs,
} from "../../shared/src/strategies.js";

function strategy(key: string): StrategyDefinition {
  const def = STRATEGY_BY_KEY[key];
  if (!def) throw new Error(`No strategy '${key}'`);
  return def;
}

/** Inputs that pass every rule of every strategy — individual tests knock one value out at a time. */
const ALL_PASS: StrategyInputs = {
  [MARKET_CAP_INPUT_KEY]: 50e9,
  earnings_yield: 0.1,
  roic: 0.2,
  ev_ebit: 6,
  debt_to_ebitda: 1.5,
  pe_ttm: 12,
  pb: 1.2,
  ps: 1.0,
  ev_ebitda: 8,
  fcf_yield: 0.09,
  piotroski_f_score: 8,
  fcf_to_net_income: 1.1,
  share_count_change: -0.02,
  avg_gross_margin_5y: 0.45,
  debt_to_equity: 0.4,
};

describe("strategy registry", () => {
  it("ships six strategies with unique keys", () => {
    expect(STRATEGIES).toHaveLength(6);
    expect(new Set(STRATEGIES.map((s) => s.key)).size).toBe(6);
  });

  it("discloses publication date and tested universe on every strategy", () => {
    for (const s of STRATEGIES) {
      expect(s.source.published.length).toBeGreaterThan(0);
      expect(s.source.testedUniverse.length).toBeGreaterThan(0);
    }
  });

  it("states on the earnings-yield strategy that the earnings-yield leg carries most of the edge", () => {
    expect(strategy("earnings_yield_roc").source.caveat).toMatch(/earnings-yield leg carries most of the documented edge/i);
  });

  it("keeps each screen formula in sync with the rules it claims to express", () => {
    // Guards the one real divergence risk in this module: the formula string and the
    // predicates are written twice, so at minimum every rule's input must appear in it.
    for (const s of STRATEGIES) {
      for (const rule of s.rules) {
        if (!rule.metricKey) continue;
        const field = rule.metricKey === MARKET_CAP_INPUT_KEY ? "marketCap" : rule.metricKey;
        expect(s.screenFormula, `${s.key} screen formula omits ${field}`).toContain(field);
      }
    }
  });
});

describe("evaluateStrategy — arithmetic", () => {
  it("counts passes over computable rules only", () => {
    const result = evaluateStrategy(strategy("owner_earnings_yield"), {
      fcf_yield: 0.09,
      fcf_to_net_income: 1.2,
      share_count_change: null,
    });
    expect(result.passed).toBe(2);
    expect(result.total).toBe(2);
    expect(result.notComputable).toBe(1);
    expect(result.results.map((r) => r.pass)).toEqual([true, true, null]);
  });

  it("reports a missing input as not computable rather than a failure, with a null actual", () => {
    const result = evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: null, pb: 1.0 });
    const fScore = result.results[0];
    expect(fScore.pass).toBeNull();
    expect(fScore.actual).toBeNull();
    expect(fScore.threshold).toBe("≥ 7 (of 9)");
  });

  it("treats a non-finite input as not computable", () => {
    const result = evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: Number.NaN, pb: Number.POSITIVE_INFINITY });
    expect(result.results.map((r) => r.pass)).toEqual([null, null]);
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
  });

  it("qualifies only when every rule passes by default", () => {
    expect(evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: 8, pb: 1.0 }).qualifies).toBe(true);
    expect(evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: 8, pb: 2.0 }).qualifies).toBe(false);
  });

  it("reports qualification as indeterminate when the missing rules could still carry it", () => {
    // 1 of 2 passing, the other unknown -> could go either way.
    expect(evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: 8, pb: null }).qualifies).toBeNull();
    // A hard fail is decided regardless of what's missing.
    expect(evaluateStrategy(strategy("f_score_value"), { piotroski_f_score: 3, pb: null }).qualifies).toBe(false);
  });

  it("carries the rule's display unit through to the result", () => {
    const result = evaluateStrategy(strategy("earnings_yield_roc"), ALL_PASS);
    expect(result.results.map((r) => r.unit)).toEqual(["percent", "percent", "currency"]);
  });

  it("supports derived rules over the whole inputs record", () => {
    const def: StrategyDefinition = {
      key: "derived_test",
      name: "Derived",
      description: "",
      source: { name: "", published: "", testedUniverse: "" },
      screenFormula: "",
      rules: [
        {
          label: "Net cash",
          derive: (i) => (i.cash === null || i.cash === undefined || i.debt === null || i.debt === undefined ? null : i.cash - i.debt),
          unit: "currency",
          test: { description: "> 0", predicate: (v) => v > 0 },
        },
      ],
    };
    expect(evaluateStrategy(def, { cash: 100, debt: 40 }).results[0]).toMatchObject({ pass: true, actual: 60 });
    expect(evaluateStrategy(def, { cash: 100, debt: null }).results[0]).toMatchObject({ pass: null, actual: null });
  });
});

describe("earnings yield + return on capital", () => {
  const def = strategy("earnings_yield_roc");

  it("passes a cheap, high-return large cap", () => {
    const r = evaluateStrategy(def, ALL_PASS);
    expect(r.passed).toBe(3);
    expect(r.qualifies).toBe(true);
  });

  it("fails the size floor below $2B", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, [MARKET_CAP_INPUT_KEY]: 1.5e9 });
    expect(r.passed).toBe(2);
    expect(r.qualifies).toBe(false);
  });

  it("treats the thresholds as strict — exactly 8% yield, 15% ROIC and $2B all fail", () => {
    const r = evaluateStrategy(def, { earnings_yield: 0.08, roic: 0.15, [MARKET_CAP_INPUT_KEY]: 2e9 });
    expect(r.results.map((x) => x.pass)).toEqual([false, false, false]);
  });
});

describe("low EV/EBIT", () => {
  const def = strategy("low_ev_ebit");

  it("passes a cheap multiple with modest leverage", () => {
    expect(evaluateStrategy(def, ALL_PASS).qualifies).toBe(true);
  });

  it("rejects a negative EV/EBIT rather than treating it as cheaper than zero", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, ev_ebit: -4 });
    expect(r.results[0].pass).toBe(false);
    expect(r.qualifies).toBe(false);
  });

  it("excludes both ends of the 0-to-8 band", () => {
    expect(evaluateStrategy(def, { ev_ebit: 0, debt_to_ebitda: 1 }).results[0].pass).toBe(false);
    expect(evaluateStrategy(def, { ev_ebit: 8, debt_to_ebitda: 1 }).results[0].pass).toBe(false);
    expect(evaluateStrategy(def, { ev_ebit: 7.99, debt_to_ebitda: 1 }).results[0].pass).toBe(true);
  });

  it("fails a cheap but heavily indebted company", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, debt_to_ebitda: 4.5 });
    expect(r.passed).toBe(1);
    expect(r.qualifies).toBe(false);
  });
});

describe("value composite", () => {
  const def = strategy("value_composite");

  it("qualifies on 4 of 5 legs", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, ps: 3.0 });
    expect(r.passed).toBe(4);
    expect(r.total).toBe(5);
    expect(r.qualifies).toBe(true);
  });

  it("does not qualify on 3 of 5 legs", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, ps: 3.0, pb: 4.0 });
    expect(r.passed).toBe(3);
    expect(r.qualifies).toBe(false);
  });

  it("qualifies on 4 passes even when the fifth leg has no data", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, ev_ebitda: null });
    expect(r.passed).toBe(4);
    expect(r.total).toBe(4);
    expect(r.notComputable).toBe(1);
    expect(r.qualifies).toBe(true);
  });

  it("is indeterminate at 3 passes with 2 unknown legs", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, ev_ebitda: null, fcf_yield: null });
    expect(r.passed).toBe(3);
    expect(r.qualifies).toBeNull();
  });
});

describe("F-score value", () => {
  const def = strategy("f_score_value");

  it("includes an F-score of exactly 7 and excludes 6", () => {
    expect(evaluateStrategy(def, { piotroski_f_score: 7, pb: 1.0 }).qualifies).toBe(true);
    expect(evaluateStrategy(def, { piotroski_f_score: 6, pb: 1.0 }).qualifies).toBe(false);
  });

  it("excludes a P/B of exactly 1.5", () => {
    expect(evaluateStrategy(def, { piotroski_f_score: 9, pb: 1.5 }).results[1].pass).toBe(false);
  });
});

describe("owner-earnings yield", () => {
  const def = strategy("owner_earnings_yield");

  it("passes a cash-backed yield with a shrinking share count", () => {
    expect(evaluateStrategy(def, ALL_PASS).qualifies).toBe(true);
  });

  it("allows a flat share count (0%) but not dilution", () => {
    expect(evaluateStrategy(def, { ...ALL_PASS, share_count_change: 0 }).results[2].pass).toBe(true);
    expect(evaluateStrategy(def, { ...ALL_PASS, share_count_change: 0.001 }).results[2].pass).toBe(false);
  });

  it("fails when free cash flow lags reported earnings", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, fcf_to_net_income: 0.5 });
    expect(r.passed).toBe(2);
    expect(r.qualifies).toBe(false);
  });
});

describe("quality at a reasonable price", () => {
  const def = strategy("quality_reasonable_price");

  it("passes durable margins bought at an ordinary multiple", () => {
    const r = evaluateStrategy(def, ALL_PASS);
    expect(r.passed).toBe(4);
    expect(r.qualifies).toBe(true);
  });

  it("fails when the returns are leverage-financed", () => {
    expect(evaluateStrategy(def, { ...ALL_PASS, debt_to_equity: 2.5 }).qualifies).toBe(false);
  });

  it("fails on a rich multiple even with excellent economics", () => {
    const r = evaluateStrategy(def, { ...ALL_PASS, pe_ttm: 45 });
    expect(r.passed).toBe(3);
    expect(r.results[2].pass).toBe(false);
  });
});

describe("evaluateAllStrategies", () => {
  it("orders by rules passed, then by fewest missing rules", () => {
    const evaluations = evaluateAllStrategies(ALL_PASS);
    expect(evaluations).toHaveLength(6);
    const passedCounts = evaluations.map((e) => e.passed);
    expect([...passedCounts].sort((a, b) => b - a)).toEqual(passedCounts);
  });

  it("returns every strategy even when there is no data at all", () => {
    const evaluations = evaluateAllStrategies({});
    expect(evaluations).toHaveLength(6);
    for (const e of evaluations) {
      expect(e.total).toBe(0);
      expect(e.passed).toBe(0);
      expect(e.qualifies).toBeNull();
    }
  });
});
