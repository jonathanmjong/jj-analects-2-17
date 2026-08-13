/**
 * Named rule-chain screens ("strategies") drawn from the published value
 * canon, evaluated against one company's raw metric values.
 *
 * Deliberately NOT scored as a percentage. A rule chain is a small set of
 * yes/no thresholds; "passes 4 of 5" is the honest summary, while "80%"
 * implies a calibration that a pass-count can't support and invites
 * comparing a 4-of-5 against a 7-of-9 as if the numbers meant the same
 * thing. Same reason there is no composite across strategies.
 *
 * Every definition carries its source's publication date and the universe it
 * was actually tested on: these rule chains were validated on specific
 * markets and eras (often small-cap-heavy, often decades ago), and this app's
 * universe is ~1,300 US mid/large caps. Where a threshold is ours rather than
 * the author's, the caveat says so.
 *
 * Lives in shared/ so the company page's scorecard and the Rankings page's
 * preset screens evaluate the identical rules — the screen formula on each
 * definition is the same chain written in the Rankings formula-filter syntax.
 */

/** Raw metric values keyed by registry metric key, plus MARKET_CAP_INPUT_KEY. Nulls mean "no data", never zero. */
export type StrategyInputs = Record<string, number | null>;

/** Market cap isn't a registry metric, so size-floor rules read it under this reserved key. */
export const MARKET_CAP_INPUT_KEY = "market_cap";

export type StrategyRuleUnit = "percent" | "multiple" | "ratio" | "currency" | "score";

export interface StrategySource {
  /** Named as an inspiration — these chains approximate published strategies, they are not the authors' exact implementations. */
  name: string;
  published: string;
  testedUniverse: string;
  caveat?: string;
}

export interface StrategyRule {
  label: string;
  /** Reads this key straight out of the inputs record. Mutually exclusive with `derive`. */
  metricKey?: string;
  /** Extension point for rules that combine several inputs; returns null when any input it needs is missing. */
  derive?: (inputs: StrategyInputs) => number | null;
  unit: StrategyRuleUnit;
  test: {
    /** Human-readable threshold, shown beside the actual value. */
    description: string;
    predicate: (value: number) => boolean;
  };
}

export interface StrategyDefinition {
  key: string;
  name: string;
  description: string;
  source: StrategySource;
  rules: StrategyRule[];
  /** Rules that must pass to qualify. Defaults to all of them; the value composite is 4-of-5 by construction. */
  minRulesToQualify?: number;
  /** The identical chain in the Rankings page's formula-filter syntax, so a preset screen and this scorecard can never disagree. */
  screenFormula: string;
}

export interface StrategyRuleResult {
  label: string;
  /** null = not computable (input missing or non-finite) — excluded from both `passed` and `total`. */
  pass: boolean | null;
  actual: number | null;
  threshold: string;
  unit: StrategyRuleUnit;
}

export interface StrategyEvaluation {
  key: string;
  name: string;
  passed: number;
  /** Computable rules only — a company missing data has a smaller denominator, not a failing grade. */
  total: number;
  notComputable: number;
  /** null = indeterminate: the missing rules could still swing it either way. */
  qualifies: boolean | null;
  results: StrategyRuleResult[];
}

// --- Definitions -----------------------------------------------------------
//
// Thresholds below are absolute cutoffs. Most of the source strategies rank
// cross-sectionally (deciles, top-30 lists) rather than applying absolute
// cutoffs; absolutes are used here because a scorecard has to answer "does
// THIS company pass" without reference to a peer set, and because a visible
// number is auditable in a way "top decile of a universe you can't see" is
// not. That substitution is itself a deviation from the sources, noted in the
// caveats where it materially changes the strategy.

export const STRATEGIES: StrategyDefinition[] = [
  {
    key: "earnings_yield_roc",
    name: "Earnings Yield + Return on Capital",
    description:
      "Cheap on operating earnings relative to enterprise value, and earning a high return on the capital employed in the business.",
    source: {
      name: "Greenblatt-inspired (the 'magic formula' pairing)",
      published: "2005 (The Little Book That Beats the Market; updated 2010)",
      testedUniverse: "~3,500 largest US-listed stocks, 1988–2004 backtest, excluding financials and utilities",
      // Binding disclosure: subsequent replications attribute most of the documented
      // outperformance to the cheapness leg, not the pairing.
      caveat:
        "The earnings-yield leg carries most of the documented edge; the return-on-capital leg adds much less than the pairing's fame suggests. Financials and utilities were excluded from the original tests and are not excluded here.",
    },
    rules: [
      // 8% earnings yield ≈ an EV/EBIT of 12.5 — roughly the cheaper half of a
      // US large-cap universe, not the deep-value tail.
      { label: "Earnings yield (EBIT / EV)", metricKey: "earnings_yield", unit: "percent", test: { description: "> 8%", predicate: (v) => v > 0.08 } },
      // 15% ROIC is the conventional line for "returns above a plausible cost of capital".
      { label: "Return on invested capital", metricKey: "roic", unit: "percent", test: { description: "> 15%", predicate: (v) => v > 0.15 } },
      // The original tests used a size floor to keep results tradeable; $2B keeps this to mid/large caps.
      { label: "Market cap", metricKey: MARKET_CAP_INPUT_KEY, unit: "currency", test: { description: "> $2B", predicate: (v) => v > 2e9 } },
    ],
    screenFormula: "earnings_yield > 8% AND roic > 15% AND marketCap > 2B",
  },
  {
    key: "low_ev_ebit",
    name: "Low EV/EBIT",
    description: "Priced cheaply on the whole-company multiple an acquirer would pay, without the debt load that usually explains it.",
    source: {
      name: "Acquirer's-Multiple-inspired (Carlisle)",
      published: "2014 (Deep Value) / 2017 (The Acquirer's Multiple)",
      testedUniverse: "US-listed stocks above a large-cap size floor, 1973–2013 backtests",
      caveat:
        "Carlisle's tests rank the universe and buy the cheapest decile; the absolute EV/EBIT cutoff here is ours. The leverage screen is an addition, not part of the published rule.",
    },
    rules: [
      // Lower bound of 0 matters: a negative EV/EBIT is a loss-making or
      // net-cash-heavy company, not a cheaper one. 8x is roughly the cheap
      // decile of a US mid/large universe.
      { label: "EV / EBIT", metricKey: "ev_ebit", unit: "multiple", test: { description: "between 0 and 8", predicate: (v) => v > 0 && v < 8 } },
      // 3x debt/EBITDA is the conventional investment-grade-ish ceiling; below it, cheapness is less likely to be distress.
      { label: "Debt / EBITDA", metricKey: "debt_to_ebitda", unit: "ratio", test: { description: "< 3", predicate: (v) => v < 3 } },
    ],
    screenFormula: "ev_ebit > 0 AND ev_ebit < 8 AND debt_to_ebitda < 3",
  },
  {
    key: "value_composite",
    name: "Value Composite",
    description: "Cheap on several unrelated value measures at once, rather than on any single ratio that one accounting quirk could flatter.",
    source: {
      name: "O'Shaughnessy-inspired (value composite)",
      published: "1996, 4th edition 2011 (What Works on Wall Street)",
      testedUniverse: "Compustat All Stocks (market cap above an inflation-adjusted ~$200M floor), 1964–2009",
      caveat:
        "The published composite ranks each factor into deciles across the universe and buys the cheapest decile of the summed rank; the absolute thresholds here are ours and are not equivalent. Passing 4 of 5 is our construction, chosen so one missing or distorted ratio can't disqualify a company.",
    },
    rules: [
      { label: "P/E (TTM)", metricKey: "pe_ttm", unit: "multiple", test: { description: "< 15", predicate: (v) => v < 15 } },
      { label: "P/B", metricKey: "pb", unit: "multiple", test: { description: "< 2", predicate: (v) => v < 2 } },
      { label: "P/S", metricKey: "ps", unit: "multiple", test: { description: "< 1.5", predicate: (v) => v < 1.5 } },
      { label: "EV / EBITDA", metricKey: "ev_ebitda", unit: "multiple", test: { description: "< 10", predicate: (v) => v < 10 } },
      { label: "FCF yield", metricKey: "fcf_yield", unit: "percent", test: { description: "> 5%", predicate: (v) => v > 0.05 } },
    ],
    // Each threshold sits near the cheap third of a US mid/large universe on
    // its own measure; the composite's point is agreement across measures, so
    // no single one is set to a deep-value extreme.
    minRulesToQualify: 4,
    screenFormula:
      "(pe_ttm < 15 AND pb < 2 AND ps < 1.5 AND ev_ebitda < 10) OR (pe_ttm < 15 AND pb < 2 AND ps < 1.5 AND fcf_yield > 5%) OR (pe_ttm < 15 AND pb < 2 AND ev_ebitda < 10 AND fcf_yield > 5%) OR (pe_ttm < 15 AND ps < 1.5 AND ev_ebitda < 10 AND fcf_yield > 5%) OR (pb < 2 AND ps < 1.5 AND ev_ebitda < 10 AND fcf_yield > 5%)",
  },
  {
    key: "f_score_value",
    name: "F-Score Value",
    description: "Trading below a modest multiple of book value, with the year-over-year financial improvement that separates recovering cheap stocks from decaying ones.",
    source: {
      name: "Piotroski-inspired",
      published: "2000 (Journal of Accounting Research)",
      testedUniverse: "Highest book-to-market quintile of US firms, 1976–1996 — predominantly small, thinly traded companies",
      caveat:
        "The documented returns concentrated in small, illiquid, low-analyst-coverage firms; this app's universe is US mid/large caps, where the effect has been much weaker in later samples.",
    },
    rules: [
      // Piotroski treats 8–9 as strong and ≤2 as weak; 7 is the common
      // practitioner cutoff for "clearly improving" without demanding perfection.
      { label: "Piotroski F-Score", metricKey: "piotroski_f_score", unit: "score", test: { description: "≥ 7 (of 9)", predicate: (v) => v >= 7 } },
      // Stands in for the original's high-book-to-market quintile: B/M > 0.67 is P/B < 1.5.
      { label: "P/B", metricKey: "pb", unit: "multiple", test: { description: "< 1.5", predicate: (v) => v < 1.5 } },
    ],
    screenFormula: "piotroski_f_score >= 7 AND pb < 1.5",
  },
  {
    key: "owner_earnings_yield",
    name: "Owner-Earnings Yield",
    description: "A high free-cash-flow yield that reported earnings actually back up, at a company not quietly issuing the return away in stock.",
    source: {
      name: "Owner-earnings tradition (Buffett's 1986 shareholder-letter definition)",
      published: "1986 (Berkshire Hathaway shareholder letter, appendix)",
      testedUniverse: "None — owner earnings is a definition, not a backtested screen",
      caveat:
        "There is no published backtest behind this chain: the concept is Buffett's, the three thresholds are ours. Free cash flow here is the reported figure and is not adjusted for maintenance-versus-growth capex, which is the adjustment the original definition actually calls for.",
    },
    rules: [
      // 8% is roughly double the long-run US equity earnings yield — the point
      // is a yield wide enough to matter, not a marginal one.
      { label: "FCF yield", metricKey: "fcf_yield", unit: "percent", test: { description: "> 8%", predicate: (v) => v > 0.08 } },
      // Cash conversion at ~1x or better: earnings that show up as cash rather than accruals.
      { label: "FCF / Net income", metricKey: "fcf_to_net_income", unit: "ratio", test: { description: "> 0.9", predicate: (v) => v > 0.9 } },
      // A flat-or-shrinking diluted share count — otherwise the per-share yield leaks to issuance.
      { label: "Share count change (YoY)", metricKey: "share_count_change", unit: "percent", test: { description: "≤ 0%", predicate: (v) => v <= 0 } },
    ],
    screenFormula: "fcf_yield > 8% AND fcf_to_net_income > 0.9 AND share_count_change <= 0",
  },
  {
    key: "quality_reasonable_price",
    name: "Quality at a Reasonable Price",
    description: "Durable, high-return economics bought at an ordinary multiple, with a balance sheet that doesn't manufacture the returns.",
    source: {
      name: "Quality-factor tradition (Novy-Marx gross profitability; Asness–Frazzini–Pedersen 'Quality Minus Junk')",
      published: "2013 (both papers; QMJ published 2019)",
      testedUniverse: "Broad US stock cross-sections, 1956–2012, as long/short factor portfolios",
      caveat:
        "The underlying research constructs long/short factor portfolios from cross-sectional ranks, not a four-rule pass/fail chain; every threshold here is ours. Treat it as a description of a company type, not a tested strategy.",
    },
    rules: [
      // Same 15% line as the return-on-capital leg above.
      { label: "Return on invested capital", metricKey: "roic", unit: "percent", test: { description: "> 15%", predicate: (v) => v > 0.15 } },
      // The 5-year average (rather than the latest year) is the point: a
      // one-year margin spike isn't evidence of pricing power.
      { label: "5-year average gross margin", metricKey: "avg_gross_margin_5y", unit: "percent", test: { description: "> 30%", predicate: (v) => v > 0.3 } },
      // "Reasonable", not cheap — roughly the long-run US market average multiple.
      { label: "P/E (TTM)", metricKey: "pe_ttm", unit: "multiple", test: { description: "< 20", predicate: (v) => v < 20 } },
      // Keeps out companies whose high ROE/ROIC is leverage rather than economics.
      { label: "Debt / Equity", metricKey: "debt_to_equity", unit: "ratio", test: { description: "< 1", predicate: (v) => v < 1 } },
    ],
    screenFormula: "roic > 15% AND avg_gross_margin_5y > 30% AND pe_ttm < 20 AND debt_to_equity < 1",
  },
];

export const STRATEGY_BY_KEY: Record<string, StrategyDefinition> = Object.fromEntries(
  STRATEGIES.map((s) => [s.key, s]),
);

function ruleValue(rule: StrategyRule, inputs: StrategyInputs): number | null {
  const raw = rule.derive ? rule.derive(inputs) : rule.metricKey === undefined ? null : inputs[rule.metricKey];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Runs one rule chain. A rule whose input is missing is reported as `pass:
 * null` and left out of both the numerator and the denominator — a company
 * we lack data on hasn't failed the test, and inflating the denominator with
 * unmeasurable rules would understate every thinly-covered company.
 */
export function evaluateStrategy(def: StrategyDefinition, inputs: StrategyInputs): StrategyEvaluation {
  const results: StrategyRuleResult[] = def.rules.map((rule) => {
    const actual = ruleValue(rule, inputs);
    return {
      label: rule.label,
      pass: actual === null ? null : rule.test.predicate(actual),
      actual,
      threshold: rule.test.description,
      unit: rule.unit,
    };
  });

  const passed = results.filter((r) => r.pass === true).length;
  const notComputable = results.filter((r) => r.pass === null).length;
  const total = results.length - notComputable;
  const required = def.minRulesToQualify ?? def.rules.length;

  // Indeterminate rather than false when the still-missing rules could, if
  // they arrived and passed, carry the chain over the line.
  const qualifies = passed >= required ? true : passed + notComputable >= required ? null : false;

  return { key: def.key, name: def.name, passed, total, notComputable, qualifies, results };
}

/** Every strategy, ordered by rules passed (then by fewest gaps) — the order the scorecard renders. */
export function evaluateAllStrategies(inputs: StrategyInputs, defs: StrategyDefinition[] = STRATEGIES): StrategyEvaluation[] {
  return defs
    .map((def) => evaluateStrategy(def, inputs))
    .sort((a, b) => b.passed - a.passed || a.notComputable - b.notComputable || a.name.localeCompare(b.name));
}
