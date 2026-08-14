/**
 * "Where does today's valuation sit inside this company's own history?" (F3).
 *
 * The history is built from SEC EDGAR's EntityPublicFloat, which is *not*
 * market cap: it is the market value of the shares held by non-affiliates,
 * measured on the last business day of the registrant's second fiscal quarter
 * — mid-year, not at fiscal year end. Every multiple derived from it is
 * therefore on a "float basis" that runs systematically smaller than a
 * market-cap basis and is dated mid-year.
 *
 * That is fine for the question this module answers — the basis is identical in
 * every year, so the company is compared against itself on like terms — and
 * fatal for the naive follow-up. Dropping today's market-cap-based multiple
 * into that distribution would make almost every company look expensive today
 * purely because the numerator changed definition. So today's observation is
 * placed on the float basis first, via a float/market-cap ratio measured on a
 * date where both quantities are observed, and when no such date exists this
 * module reports no percentile at all rather than a wrong one.
 *
 * Pure math, no I/O — same rule as rankingMath.ts and valuation.ts.
 */

import type { BalanceSheet, IncomeStatement } from "./financials.js";

/** Firestore subcollection: companies/{ticker}/valuationHistory/{fiscalYear} */
export interface ValuationHistoryEntry {
  fiscalYear: number;
  /** Cover-page measurement date of publicFloat: the last business day of fiscal Q2 (YYYY-MM-DD). */
  floatAsOf: string;
  /** EDGAR EntityPublicFloat — market value of non-affiliate shares, NOT market cap. */
  publicFloat: number;
  netIncome: number | null;
  revenue: number | null;
  totalEquity: number | null;
  operatingIncome: number | null;
  totalDebt: number | null;
  cash: number | null;
  sharesOutstanding: number | null;
  source: string;
}

export type MultipleKey = "floatPe" | "floatPs" | "floatPb" | "floatEvEbit";

export const MULTIPLE_KEYS: MultipleKey[] = ["floatPe", "floatPs", "floatPb", "floatEvEbit"];

export const MULTIPLE_LABELS: Record<MultipleKey, string> = {
  floatPe: "P/E",
  floatPs: "P/S",
  floatPb: "P/B",
  floatEvEbit: "EV/EBIT",
};

export const MULTIPLE_FORMULAS: Record<MultipleKey, string> = {
  floatPe: "public float ÷ net income",
  floatPs: "public float ÷ revenue",
  floatPb: "public float ÷ total equity",
  floatEvEbit: "(public float + total debt − cash) ÷ operating income",
};

export interface HistoricalMultiples {
  fiscalYear: number;
  floatAsOf: string;
  floatPe: number | null;
  floatPs: number | null;
  floatPb: number | null;
  floatEvEbit: number | null;
}

/**
 * Fewer than this many usable years is a handful of points, not a
 * distribution: quartiles computed on four observations are just the four
 * observations relabelled.
 */
export const MIN_DISTRIBUTION_YEARS = 5;

/**
 * A year-on-year move this large in revenue or equity is almost never organic
 * — it reads as an acquisition, a divestiture or a restatement, and across
 * that boundary "the same company" stops being true.
 */
export const DISCONTINUITY_YOY_THRESHOLD = 0.6;

/** Plausible range for non-affiliate float as a fraction of market cap. Float cannot exceed market cap; anything above ~1 is date noise, and a ratio this small means the anchor is measuring something else. */
export const FLOAT_RATIO_BOUNDS = { min: 0.05, max: 1.05 };

/** Sectors where an enterprise-value multiple is not interpretable: debt is raw material for lenders and the capital structure is the business for REITs. Book value is *more* meaningful for both, so only the EV multiple is withheld. */
export const EV_MULTIPLE_EXCLUDED_SECTORS = ["Financials", "Real Estate"];

/**
 * Only a strictly positive denominator produces a meaningful multiple. A
 * negative-earnings P/E is not "cheap", it is undefined — it must be omitted
 * from the distribution, never rendered and never winsorized into the band.
 */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/** Enterprise value on the float basis: the float stands in for the equity market value, debt and cash are taken at fiscal year end. */
function floatEnterpriseValue(publicFloat: number, totalDebt: number | null, cash: number | null): number | null {
  if (!Number.isFinite(publicFloat) || publicFloat <= 0) return null;
  if (totalDebt === null || cash === null) return null;
  const ev = publicFloat + totalDebt - cash;
  return Number.isFinite(ev) && ev > 0 ? ev : null;
}

export function computeHistoricalMultiples(entries: ValuationHistoryEntry[]): HistoricalMultiples[] {
  return [...entries]
    .filter((entry) => Number.isFinite(entry.publicFloat) && entry.publicFloat > 0)
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .map((entry) => ({
      fiscalYear: entry.fiscalYear,
      floatAsOf: entry.floatAsOf,
      floatPe: ratio(entry.publicFloat, entry.netIncome),
      floatPs: ratio(entry.publicFloat, entry.revenue),
      floatPb: ratio(entry.publicFloat, entry.totalEquity),
      floatEvEbit: ratio(floatEnterpriseValue(entry.publicFloat, entry.totalDebt, entry.cash), entry.operatingIncome),
    }));
}

export interface DistributionSummary {
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  n: number;
}

export interface DistributionOutcome {
  summary: DistributionSummary | null;
  /** Plain-language explanation when summary is null; null when it is populated. */
  reason: string | null;
}

/**
 * Linear-interpolation quantile (the R type-7 / Excel PERCENTILE convention)
 * on an already-sorted ascending array.
 */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lower = Math.floor(h);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (h - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * Median and quartiles, deliberately not mean and standard deviation:
 * valuation multiples are bounded below by zero and unbounded above, so a
 * single re-rating year drags a mean somewhere no year ever was, and a
 * symmetric ±σ band implies a symmetry the data does not have.
 */
export function summarizeDistribution(values: number[]): DistributionOutcome {
  const usable = values.filter((v) => v !== null && Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (usable.length < MIN_DISTRIBUTION_YEARS) {
    return {
      summary: null,
      reason: `only ${usable.length} fiscal ${usable.length === 1 ? "year has" : "years have"} a usable value, and at least ${MIN_DISTRIBUTION_YEARS} are needed before quartiles describe anything`,
    };
  }
  return {
    summary: {
      median: quantile(usable, 0.5),
      q1: quantile(usable, 0.25),
      q3: quantile(usable, 0.75),
      min: usable[0],
      max: usable[usable.length - 1],
      n: usable.length,
    },
    reason: null,
  };
}

/**
 * Where today's observation falls inside the historical values, 0–100.
 * Midpoint ("mean rank") convention, so a value equal to one historical
 * observation lands between the ranks below and above it rather than
 * arbitrarily claiming one side.
 *
 * Returns null when today's value is absent or non-positive (the basis
 * normalization was unavailable, or the denominator is negative and the
 * multiple is undefined) — the caller must render no percentile at all in that
 * case rather than a placeholder.
 */
export function percentileOfToday(todayValue: number | null, historicalValues: number[]): number | null {
  if (todayValue === null || !Number.isFinite(todayValue) || todayValue <= 0) return null;
  const usable = historicalValues.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length < MIN_DISTRIBUTION_YEARS) return null;

  let below = 0;
  let equal = 0;
  for (const value of usable) {
    if (value < todayValue) below += 1;
    else if (value === todayValue) equal += 1;
  }
  return ((below + equal / 2) / usable.length) * 100;
}

export interface Discontinuity {
  fiscalYear: number;
  /** The lines that moved, with their year-on-year change as a fraction (0.8 = +80%). */
  drivers: Array<{ field: "revenue" | "totalEquity"; changePct: number }>;
  note: string;
}

function pctText(change: number): string {
  const pct = change * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

/**
 * Continuity flags: fiscal years where the business the multiples describe
 * plausibly stopped being the same business. Only consecutive fiscal years are
 * compared — across a missing year a "year-on-year" change is not what it
 * claims to be.
 */
export function detectDiscontinuities(entries: ValuationHistoryEntry[]): Discontinuity[] {
  const sorted = [...entries].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const flags: Discontinuity[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prior = sorted[i - 1];
    const current = sorted[i];
    if (current.fiscalYear - prior.fiscalYear !== 1) continue;

    const drivers: Discontinuity["drivers"] = [];
    for (const field of ["revenue", "totalEquity"] as const) {
      const before = prior[field];
      const after = current[field];
      if (before === null || after === null) continue;
      if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) continue;
      // A sign flip (equity going negative, most often) is a regime change no
      // percentage change describes honestly, so it is flagged on its own.
      const signFlipped = before > 0 !== after > 0;
      const change = (after - before) / Math.abs(before);
      if (signFlipped || Math.abs(change) > DISCONTINUITY_YOY_THRESHOLD) {
        drivers.push({ field, changePct: change });
      }
    }

    if (drivers.length === 0) continue;
    const parts = drivers.map(
      (d) => `${d.field === "revenue" ? "revenue" : "total equity"} moved ${pctText(d.changePct)}`,
    );
    flags.push({
      fiscalYear: current.fiscalYear,
      drivers,
      note: `FY${current.fiscalYear}: ${parts.join(" and ")} versus FY${prior.fiscalYear}. Moves that size usually mean an acquisition, a divestiture or a restatement, so the years either side of this one may not describe the same business.`,
    });
  }

  return flags;
}

/** Today's fundamentals, on the same lines as a historical entry, for placing today's observation. */
export interface TodayFundamentals {
  fiscalYear: number | null;
  netIncome: number | null;
  revenue: number | null;
  totalEquity: number | null;
  operatingIncome: number | null;
  totalDebt: number | null;
  cash: number | null;
}

/**
 * Today's fundamentals read off the latest annual statements, so the panel does
 * not have to know which line item feeds which multiple. The latest *fiscal
 * year* is used rather than a TTM figure because every historical entry is an
 * annual figure — mixing a TTM numerator into an annual distribution would add
 * a second basis mismatch on top of the float one.
 */
export function todayFundamentalsFromStatements(
  income: IncomeStatement[],
  balance: BalanceSheet[],
): TodayFundamentals {
  const latestIncome = [...income].sort((a, b) => b.fiscalYear - a.fiscalYear).find((s) => s.periodType === "FY") ?? null;
  const latestBalance = [...balance].sort((a, b) => b.fiscalYear - a.fiscalYear).find((s) => s.periodType === "FY") ?? null;
  return {
    fiscalYear: latestIncome?.fiscalYear ?? latestBalance?.fiscalYear ?? null,
    netIncome: latestIncome?.netIncome ?? null,
    revenue: latestIncome?.revenue ?? null,
    totalEquity: latestBalance?.totalEquity ?? null,
    operatingIncome: latestIncome?.operatingIncome ?? latestIncome?.ebit ?? null,
    totalDebt: latestBalance?.totalDebt ?? null,
    cash: latestBalance?.cashAndEquivalents ?? null,
  };
}

/**
 * A date where both a public float and a market cap were observed, used to
 * measure what fraction of this company's market cap is non-affiliate float.
 */
export interface FloatAnchor {
  fiscalYear: number;
  /** floatAsOf of the entry the ratio is measured on. */
  floatAsOf: string;
  /** Date of the observed market cap; must be near floatAsOf or the ratio is measuring price drift. */
  marketCapAsOf: string;
  marketCap: number;
  publicFloat: number;
}

export interface Normalization {
  /** publicFloat ÷ market cap on the anchor date. Today's market cap is multiplied by this to land on the float basis. */
  floatRatio: number;
  anchorFiscalYear: number;
  anchorFloatAsOf: string;
  anchorMarketCapAsOf: string;
}

export interface MultipleDistribution {
  key: MultipleKey;
  label: string;
  formula: string;
  observations: Array<{ fiscalYear: number; value: number }>;
  summary: DistributionSummary | null;
  /** Why there is no summary, or why the multiple is withheld for this sector. Null when everything is available. */
  reason: string | null;
  suppressed: boolean;
  /** Today's multiple placed on the float basis. Null whenever it is not comparable. */
  todayFloatBasisValue: number | null;
  /** Today's multiple on the ordinary market-cap basis. NOT comparable with the distribution — never plot it on the band. */
  todayMarketCapBasisValue: number | null;
  todayPercentile: number | null;
}

export interface OwnHistoryAssumptions {
  basis: string;
  normalization: string;
  normalizationFactor: number | null;
  anchorFiscalYear: number | null;
  anchorFloatAsOf: string | null;
  anchorMarketCapAsOf: string | null;
  /** e.g. "FY2015–FY2025, 11 years". Null when there are no entries at all. */
  window: string | null;
  fiscalYears: number[];
  todayFundamentalsFiscalYear: number | null;
  suppressedMultiples: Array<{ key: MultipleKey; reason: string }>;
  /** Honest resolution note: with n annual observations a percentile cannot be finer than 100/n. */
  percentileResolution: string | null;
}

export interface OwnHistoryValuationReport {
  status: "ok" | "insufficient" | "not-comparable";
  reason: string | null;
  multiples: MultipleDistribution[];
  discontinuities: Discontinuity[];
  assumptions: OwnHistoryAssumptions;
}

export interface OwnHistoryValuationInput {
  entries: ValuationHistoryEntry[];
  todayMarketCap: number | null;
  todayFundamentals: TodayFundamentals;
  sector: string | null;
  /**
   * Market caps observed close to a historical entry's floatAsOf date. Supplied
   * by the caller (the daily marketData series only reaches back to mid-2026,
   * so at most the newest fiscal year or two can be anchored, and usually
   * none can).
   */
  anchors?: FloatAnchor[];
  /**
   * Set when today's marketCap is itself EDGAR's public float rather than a
   * live quote (LatestSnapshot.priceSource === "sec_public_float"): it is then
   * already on the float basis and must not be scaled again.
   */
  todayMarketCapIsPublicFloat?: boolean;
}

const BASIS_NOTE =
  "Every historical multiple here is built on SEC EDGAR's public float — the market value of shares held by non-affiliates, measured on the last business day of the company's second fiscal quarter, not at fiscal year end and not the same thing as market cap.";

/** Days between the anchor's market-cap date and the float measurement date beyond which the ratio is measuring price movement rather than the float share. */
const ANCHOR_MAX_DAY_GAP = 10;

function daysBetween(a: string, b: string): number | null {
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return Math.abs(first - second) / 86_400_000;
}

/**
 * The float/market-cap ratio is roughly stable year to year for a mid/large cap
 * (insider and affiliate holdings move slowly), so a ratio measured on the most
 * recent date where both quantities were observed is a defensible way to put
 * today's market cap on the same basis as the history. It is only defensible
 * when the two observations are close in time: measured a quarter apart, the
 * "ratio" would mostly encode the share price move between the two dates.
 */
export function resolveNormalization(anchors: FloatAnchor[]): { normalization: Normalization | null; reason: string | null } {
  const candidates = [...anchors].sort((a, b) => b.fiscalYear - a.fiscalYear);
  for (const anchor of candidates) {
    if (!Number.isFinite(anchor.marketCap) || anchor.marketCap <= 0) continue;
    if (!Number.isFinite(anchor.publicFloat) || anchor.publicFloat <= 0) continue;
    const gap = daysBetween(anchor.floatAsOf, anchor.marketCapAsOf);
    if (gap === null || gap > ANCHOR_MAX_DAY_GAP) continue;
    const floatRatio = anchor.publicFloat / anchor.marketCap;
    if (floatRatio < FLOAT_RATIO_BOUNDS.min || floatRatio > FLOAT_RATIO_BOUNDS.max) continue;
    return {
      normalization: {
        floatRatio,
        anchorFiscalYear: anchor.fiscalYear,
        anchorFloatAsOf: anchor.floatAsOf,
        anchorMarketCapAsOf: anchor.marketCapAsOf,
      },
      reason: null,
    };
  }
  return {
    normalization: null,
    reason:
      "no date exists yet where this company's public float and its market cap were both observed, so today's market-cap-based multiple cannot be put on the same basis as the history",
  };
}

function windowText(fiscalYears: number[]): string | null {
  if (fiscalYears.length === 0) return null;
  const first = fiscalYears[0];
  const last = fiscalYears[fiscalYears.length - 1];
  if (first === last) return `FY${first}, 1 year`;
  return `FY${first}–FY${last}, ${fiscalYears.length} ${fiscalYears.length === 1 ? "year" : "years"}`;
}

function todayMultiple(
  key: MultipleKey,
  floatBasisEquityValue: number | null,
  fundamentals: TodayFundamentals,
): number | null {
  if (floatBasisEquityValue === null) return null;
  switch (key) {
    case "floatPe":
      return ratio(floatBasisEquityValue, fundamentals.netIncome);
    case "floatPs":
      return ratio(floatBasisEquityValue, fundamentals.revenue);
    case "floatPb":
      return ratio(floatBasisEquityValue, fundamentals.totalEquity);
    case "floatEvEbit":
      return ratio(
        floatEnterpriseValue(floatBasisEquityValue, fundamentals.totalDebt, fundamentals.cash),
        fundamentals.operatingIncome,
      );
  }
}

export function computeOwnHistoryValuation(input: OwnHistoryValuationInput): OwnHistoryValuationReport {
  const { entries, todayMarketCap, todayFundamentals, sector } = input;
  const history = computeHistoricalMultiples(entries);
  const fiscalYears = history.map((h) => h.fiscalYear);
  const discontinuities = detectDiscontinuities(entries);

  const evSuppressed = sector !== null && EV_MULTIPLE_EXCLUDED_SECTORS.includes(sector);
  const evSuppressionReason = `an enterprise-value multiple is not interpretable for ${sector} companies — debt is raw material for a lender and the capital structure is the business for a property owner. P/E, P/S and P/B are still shown, and book value is if anything more meaningful here than elsewhere.`;

  const { normalization, reason: normalizationReason } = resolveNormalization(input.anchors ?? []);

  // A market cap that is itself EDGAR's public float (the ingestion fallback
  // when no live quote is available) is already on the float basis — scaling it
  // again would shrink it twice.
  const floatBasisEquityValue =
    todayMarketCap === null || !Number.isFinite(todayMarketCap) || todayMarketCap <= 0
      ? null
      : input.todayMarketCapIsPublicFloat
        ? todayMarketCap
        : normalization === null
          ? null
          : todayMarketCap * normalization.floatRatio;

  const suppressedMultiples: OwnHistoryAssumptions["suppressedMultiples"] = [];
  const multiples: MultipleDistribution[] = MULTIPLE_KEYS.map((key) => {
    const observations = history
      .map((h) => ({ fiscalYear: h.fiscalYear, value: h[key] }))
      .filter((o): o is { fiscalYear: number; value: number } => o.value !== null);

    if (key === "floatEvEbit" && evSuppressed) {
      suppressedMultiples.push({ key, reason: evSuppressionReason });
      return {
        key,
        label: MULTIPLE_LABELS[key],
        formula: MULTIPLE_FORMULAS[key],
        observations: [],
        summary: null,
        reason: evSuppressionReason,
        suppressed: true,
        todayFloatBasisValue: null,
        todayMarketCapBasisValue: null,
        todayPercentile: null,
      };
    }

    const values = observations.map((o) => o.value);
    const { summary, reason } = summarizeDistribution(values);
    const todayFloatBasisValue = todayMultiple(key, floatBasisEquityValue, todayFundamentals);
    const todayMarketCapBasisValue = todayMultiple(
      key,
      todayMarketCap !== null && Number.isFinite(todayMarketCap) && todayMarketCap > 0 ? todayMarketCap : null,
      todayFundamentals,
    );

    return {
      key,
      label: MULTIPLE_LABELS[key],
      formula: MULTIPLE_FORMULAS[key],
      observations,
      summary,
      reason,
      suppressed: false,
      todayFloatBasisValue,
      todayMarketCapBasisValue,
      todayPercentile: summary === null ? null : percentileOfToday(todayFloatBasisValue, values),
    };
  });

  const distributionCount = multiples.filter((m) => m.summary !== null).length;
  const percentileCount = multiples.filter((m) => m.todayPercentile !== null).length;

  let status: OwnHistoryValuationReport["status"];
  let reason: string | null;
  if (distributionCount === 0) {
    status = "insufficient";
    reason =
      entries.length === 0
        ? "no public-float history has been ingested for this company yet"
        : `${entries.length} fiscal ${entries.length === 1 ? "year is" : "years are"} on file, but no multiple has ${MIN_DISTRIBUTION_YEARS} years with a positive denominator — a loss-making or missing year cannot contribute a multiple`;
  } else if (percentileCount === 0) {
    status = "not-comparable";
    reason =
      floatBasisEquityValue === null
        ? (normalizationReason ??
          "today's market value cannot be placed on the float basis the history is measured on")
        : "today's fundamentals do not support any of these multiples — the denominators are missing or not positive";
  } else {
    status = "ok";
    reason = null;
  }

  const maxN = Math.max(0, ...multiples.map((m) => m.summary?.n ?? 0));

  const assumptions: OwnHistoryAssumptions = {
    basis: BASIS_NOTE,
    normalization:
      input.todayMarketCapIsPublicFloat && floatBasisEquityValue !== null
        ? "Today's value is EDGAR's public float too (no live quote was available), so it is already on the same basis as the history and is used unscaled."
        : normalization === null
          ? `Today's value is not placed on the band: ${normalizationReason}.`
          : `Today's market cap is multiplied by ${normalization.floatRatio.toFixed(2)} — the share of market cap that was non-affiliate float on ${normalization.anchorFloatAsOf} (FY${normalization.anchorFiscalYear}), the most recent date where both were observed. This assumes the affiliate share of the register has not moved much since, which is the usual case for a company this size but is an assumption, not a measurement.`,
    normalizationFactor: normalization?.floatRatio ?? (input.todayMarketCapIsPublicFloat ? 1 : null),
    anchorFiscalYear: normalization?.anchorFiscalYear ?? null,
    anchorFloatAsOf: normalization?.anchorFloatAsOf ?? null,
    anchorMarketCapAsOf: normalization?.anchorMarketCapAsOf ?? null,
    window: windowText(fiscalYears),
    fiscalYears,
    todayFundamentalsFiscalYear: todayFundamentals.fiscalYear,
    suppressedMultiples,
    percentileResolution:
      maxN === 0
        ? null
        : `With ${maxN} annual observations, the finest distinction a percentile here can draw is about ${Math.round(100 / maxN)} points — read it as a region of the range, not a rank.`,
  };

  return { status, reason, multiples, discontinuities, assumptions };
}
