/**
 * Deterministic synthetic universe + canonical serializers used by the ranking-engine
 * output-equivalence regression (see rankingEngineEquivalence.test.ts).
 *
 * Self-contained on purpose: the metric definitions here are copies of real registry entries
 * rather than an import of METRIC_DEFINITIONS, so the frozen baseline stays a statement about the
 * *engine* and doesn't have to be regenerated every time a metric is added to the registry.
 */
import type {
  MetricCategory,
  MetricDefinition,
  RankingComputation,
  RankingResult,
  RankingWeightsConfig,
  UniverseCompanyData,
} from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG } from "@proverbs/shared";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

interface MetricSpec {
  key: string;
  category: MetricCategory;
  direction: "asc" | "desc";
  negativeIsBad?: boolean;
  sectorRelative?: boolean;
  enabled?: boolean;
}

const METRIC_SPECS: MetricSpec[] = [
  // valuation — includes the two Real-Estate-restricted metrics
  { key: "pe_ttm", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "ev_ebitda", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "ev_ebit", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "pb", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "ps", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "earnings_yield", category: "valuation", direction: "desc" },
  { key: "fcf_yield", category: "valuation", direction: "desc" },
  { key: "price_to_ffo", category: "valuation", direction: "asc", negativeIsBad: true },
  { key: "ffo_yield", category: "valuation", direction: "desc" },
  { key: "disabled_metric", category: "valuation", direction: "desc", enabled: false },

  { key: "momentum_12m1m", category: "momentum", direction: "desc" },
  { key: "momentum_risk_adj_3m", category: "momentum", direction: "desc" },
  { key: "momentum_risk_adj_6m", category: "momentum", direction: "desc" },

  { key: "roic", category: "profitability", direction: "desc" },
  { key: "roe", category: "profitability", direction: "desc" },
  { key: "gross_margin", category: "profitability", direction: "desc" },
  { key: "operating_margin", category: "profitability", direction: "desc" },
  { key: "net_margin", category: "profitability", direction: "desc" },

  { key: "growth_revenue_1y", category: "growth", direction: "desc" },
  { key: "growth_revenue_3y", category: "growth", direction: "desc" },
  { key: "growth_eps_1y", category: "growth", direction: "desc" },
  { key: "growth_fcf_3y", category: "growth", direction: "desc" },

  { key: "ocf_margin", category: "cashGeneration", direction: "desc" },
  { key: "fcf_to_revenue", category: "cashGeneration", direction: "desc" },
  { key: "fcf_to_net_income", category: "cashGeneration", direction: "desc" },
  { key: "cash_conversion_ratio", category: "cashGeneration", direction: "desc" },

  { key: "debt_to_equity", category: "financialStrength", direction: "asc", negativeIsBad: true },
  { key: "current_ratio", category: "financialStrength", direction: "desc" },
  { key: "quick_ratio", category: "financialStrength", direction: "desc" },
  { key: "interest_coverage", category: "financialStrength", direction: "desc" },
  { key: "net_cash_to_market_cap", category: "financialStrength", direction: "desc" },

  { key: "dividend_yield", category: "capitalAllocation", direction: "desc" },
  { key: "buyback_yield", category: "capitalAllocation", direction: "desc" },
  { key: "share_count_change", category: "capitalAllocation", direction: "asc" },
  { key: "capex_to_revenue", category: "capitalAllocation", direction: "asc" },

  { key: "asset_turnover", category: "efficiency", direction: "desc", sectorRelative: true },
  { key: "inventory_turnover", category: "efficiency", direction: "desc", sectorRelative: true },
  { key: "receivable_turnover", category: "efficiency", direction: "desc", sectorRelative: true },
  { key: "cash_conversion_cycle", category: "efficiency", direction: "asc" },
  // Every company carries the identical value — total ties through winsorize + percentile/zscore.
  { key: "constant_metric", category: "efficiency", direction: "desc" },

  { key: "accrual_ratio", category: "earningsQuality", direction: "asc" },
  // 0/1 valued: huge tie groups plus a legitimate zero.
  { key: "fcf_exceeds_net_income", category: "earningsQuality", direction: "desc" },
  { key: "revenue_volatility", category: "earningsQuality", direction: "asc" },

  { key: "avg_roic_5y", category: "moat", direction: "desc" },
  { key: "rnd_to_revenue", category: "moat", direction: "asc" },
  { key: "intangible_assets_pct", category: "moat", direction: "desc" },
  // Never has a value for anyone — exercises the "no peer group at all" path.
  { key: "all_null_metric", category: "moat", direction: "desc" },
];

export const FIXTURE_METRICS: MetricDefinition[] = METRIC_SPECS.map((spec) => ({
  key: spec.key,
  label: spec.key,
  category: spec.category,
  direction: spec.direction,
  unit: "ratio",
  description: "fixture",
  enabled: spec.enabled ?? true,
  ...(spec.negativeIsBad ? { negativeIsBad: true } : {}),
  ...(spec.sectorRelative ? { sectorRelative: true } : {}),
}));

/** Sector -> company count. Includes two single-company sectors and a 2-company null-sector group. */
const SECTOR_PLAN: Array<[string | null, number]> = [
  ["Financials", 52],
  ["Financial Services", 6], // alias wording — must canonicalize to Financials
  ["Real Estate", 34],
  ["Technology", 66],
  ["Consumer Discretionary", 52],
  ["Industrials", 48],
  ["Health Care", 40],
  ["Energy", 20],
  ["Utilities", 1], // single-company sector: sectorRelative metrics must skip it
  ["Materials", 1],
  [null, 2],
];

interface MetricProfile {
  base: number;
  scale: number;
  nullRate: number;
  negRate: number;
  zeroRate: number;
  /** Rounding step — small steps manufacture the ties that make percentile stability observable. */
  quantum: number;
}

function profileFor(key: string): MetricProfile {
  const h = hashString(key);
  const r = mulberry32(h);
  return {
    base: 1 + r() * 40,
    scale: 0.5 + r() * 25,
    nullRate: 0.05 + r() * 0.3,
    negRate: r() * 0.35,
    zeroRate: r() * 0.06,
    quantum: [0.001, 0.01, 0.1, 0.25, 1][Math.floor(r() * 5)],
  };
}

export function buildFixtureUniverse(): UniverseCompanyData[] {
  const rand = mulberry32(0x5eed1234);
  const universe: UniverseCompanyData[] = [];
  const profiles = new Map(FIXTURE_METRICS.map((m) => [m.key, profileFor(m.key)]));

  let n = 0;
  for (const [sector, count] of SECTOR_PLAN) {
    for (let i = 0; i < count; i++) {
      const ticker = `T${String(n).padStart(4, "0")}`;
      n++;
      // 1-5 years of history, so year-weight renormalization over "present years" is exercised.
      const yearCount = 1 + Math.floor(rand() * 5);
      const byYear: Array<Record<string, number | null>> = [];
      for (let y = 0; y < yearCount; y++) {
        const values: Record<string, number | null> = {};
        for (const metric of FIXTURE_METRICS) {
          const p = profiles.get(metric.key)!;
          if (metric.key === "all_null_metric") {
            values[metric.key] = null;
            continue;
          }
          if (metric.key === "constant_metric") {
            values[metric.key] = 2.5;
            continue;
          }
          if (metric.key === "fcf_exceeds_net_income") {
            values[metric.key] = rand() < 0.12 ? null : rand() < 0.5 ? 0 : 1;
            continue;
          }
          if (rand() < p.nullRate) {
            values[metric.key] = null;
            continue;
          }
          if (rand() < p.zeroRate) {
            values[metric.key] = 0;
            continue;
          }
          const magnitude = p.base + (rand() - 0.5) * p.scale * (1 + y * 0.15);
          const signed = rand() < p.negRate ? -magnitude : magnitude;
          values[metric.key] = Math.round(signed / p.quantum) * p.quantum;
        }
        byYear.push(values);
      }
      universe.push({ ticker, sector, byYear });
    }
  }
  return universe;
}

export const FIXTURE_CONFIGS: Array<{ name: string; config: RankingWeightsConfig }> = [
  { name: "default", config: DEFAULT_RANKING_CONFIG },
  {
    name: "zscore-3y-custom-weights",
    config: {
      categoryWeights: {
        valuation: 0.25,
        momentum: 0.2,
        profitability: 0.1,
        growth: 0.1,
        cashGeneration: 0,
        financialStrength: 0.1,
        capitalAllocation: 0.05,
        efficiency: 0.1,
        earningsQuality: 0.05,
        moat: 0.05,
      },
      normalizationMethod: "zscore",
      winsorizeLowerPct: 0.05,
      winsorizeUpperPct: 0.95,
      yearsIncluded: 3,
      metricWeights: {
        roic: 0,
        current_ratio: 0,
        constant_metric: 0,
        pe_ttm: 2.5,
        growth_revenue_1y: 0.1,
        ffo_yield: 3,
      },
    },
  },
  {
    name: "single-year-no-winsorize",
    config: { ...DEFAULT_RANKING_CONFIG, yearsIncluded: 1, winsorizeLowerPct: 0, winsorizeUpperPct: 1 },
  },
];

/** Exact round-trippable rendering — Number#toString is lossless for doubles, so this is a bit-for-bit comparison. */
/**
 * Rounded to 14 significant digits rather than `String(v)`. The z-score
 * normalization path runs values through `Math.exp` (logistic squashing), and
 * ECMAScript explicitly permits transcendental functions to differ in the last
 * ULP between engines and CPU architectures — this baseline is generated on one
 * machine and asserted on another in CI, where a handful of companies differed
 * in the final digit. 14 significant digits is far tighter than any real
 * algorithmic change could hide in (those move values by whole percent) while
 * being immune to last-ULP drift. The percentile path, which production uses by
 * default, involves no transcendentals and is unaffected either way.
 */
function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return "~";
  if (!Number.isFinite(v)) return String(v);
  return v.toPrecision(14);
}

/** Canonical, exact serialization of one result. Excludes computedAt (wall clock) and weightsUsed (the caller's own object). */
export function serializeResult(r: RankingResult): string {
  const cats = r.categoryScores
    .map((c) => [c.category, num(c.score), num(c.weight), c.metricsIncluded, c.metricsMissing, num(c.metricsNotApplicable)].join(","))
    .join(";");
  const cov = r.coverage
    ? [r.coverage.metricsIncluded, r.coverage.metricsApplicable, num(r.coverage.ratio), r.coverage.tier].join(",")
    : "~";
  return [r.ticker, num(r.overallRank), num(r.overallScore), r.peerCount, cov, cats].join("|");
}

export function serializeResults(results: RankingResult[]): string[] {
  return results.map(serializeResult);
}

/** Canonical serialization of the metricUnitScores maps, in (metric, year, universe-order ticker) order. */
export function serializeUnitScores(
  computation: RankingComputation,
  metrics: MetricDefinition[],
  universe: UniverseCompanyData[],
  years: number,
): string[] {
  const out: string[] = [];
  for (const metric of metrics) {
    if (!metric.enabled) continue;
    const perYear = computation.metricUnitScores.get(metric.key);
    if (!perYear) {
      out.push(`${metric.key}|absent`);
      continue;
    }
    for (let y = 0; y < years; y++) {
      const stats = perYear.get(y);
      if (!stats) {
        out.push(`${metric.key}|${y}|absent`);
        continue;
      }
      const parts: string[] = [
        `${metric.key}|${y}|${stats.scoreByTicker.size},${stats.rankByTicker.size},${stats.peerCountByTicker.size}`,
      ];
      for (const c of universe) {
        const s = stats.scoreByTicker.get(c.ticker);
        if (s === undefined) continue;
        parts.push(`${c.ticker}=${num(s)}/${num(stats.rankByTicker.get(c.ticker))}/${num(stats.peerCountByTicker.get(c.ticker))}`);
      }
      out.push(parts.join(" "));
    }
  }
  return out;
}

export function digest(lines: string[]): string {
  // 64-bit-ish: two independent FNV-1a streams with different offsets.
  let h1 = 2166136261 >>> 0;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ (c + 0x9e37), 2246822519) >>> 0;
    }
    h1 = Math.imul(h1 ^ 10, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ 10, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

/** Tickers whose full serialization is frozen literally in the baseline (the rest are covered by the digest). */
export function sampleTickers(universe: UniverseCompanyData[]): string[] {
  const picked: string[] = [];
  const seenSector = new Set<string>();
  for (const c of universe) {
    const key = String(c.sector);
    if (!seenSector.has(key)) {
      seenSector.add(key);
      picked.push(c.ticker);
    }
  }
  for (let i = 0; i < universe.length; i += 37) picked.push(universe[i].ticker);
  return [...new Set(picked)].sort();
}
