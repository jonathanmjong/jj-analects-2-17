/**
 * Cyclically-adjusted ("normalized") earnings — the mid-cycle counterweight to
 * every trailing multiple in this app.
 *
 * A trailing P/E divides today's price by whatever the last twelve months
 * happened to produce. For a business whose earnings swing with a cycle —
 * semiconductors, chemicals, autos, energy, shipping, and to a lesser extent
 * banks — that denominator is at its largest exactly when the cycle is at its
 * top, so the stock screens cheapest at the worst moment to buy it and
 * dearest at the best one. Averaging earnings across a whole cycle removes
 * that: the denominator stops being one year's outcome and becomes an estimate
 * of what the business earns on average through good years and bad.
 *
 * Two things this module is NOT:
 *
 *  1. It is NOT Shiller's CAPE. A true CAPE deflates every year's earnings by
 *     CPI before averaging, so a dollar earned ten years ago counts for what it
 *     would be worth today. There is no inflation series in this system and no
 *     way to fetch one, so this is a NOMINAL average: older years are counted
 *     in their own smaller dollars. The bias has a known direction — the
 *     average comes out too low, and the multiple built on it therefore too
 *     high — and it is stated in the output rather than left for the reader to
 *     work out.
 *
 *  2. It is NOT per-share. The average is of aggregate net income and the
 *     numerator is aggregate market cap, so share issuance or buybacks over the
 *     window are not adjusted for. Where the share count has moved materially
 *     across the window that is surfaced as a caveat.
 *
 * Input is the `companies/{ticker}/valuationHistory` subcollection, which is the
 * only place in this system with more than five years of annual fundamentals.
 * Note it is used here purely for its `netIncome`/`revenue` lines — the
 * `publicFloat` basis that makes valuationHistory.ts complicated does not enter
 * into anything computed here, and the market cap passed in is an ordinary
 * market cap, not a float.
 *
 * Pure math, no I/O — same rule as rankingMath.ts, valuation.ts and
 * valuationHistory.ts.
 */

import { canonicalSector } from "./sectorApplicability.js";
import type { ValuationHistoryEntry } from "./valuationHistory.js";

/**
 * The longest window used. Ten years is the upper end of the range Graham
 * prescribed for average earnings in Security Analysis and the length Shiller
 * settled on; beyond it the early years increasingly describe a different
 * company, and the nominal-dollar bias above compounds.
 */
export const MAX_NORMALIZED_WINDOW_YEARS = 10;

/**
 * The shortest window accepted. Seven, for three reasons that point the same
 * way:
 *
 *  - Graham's own prescription for average earnings is seven to ten years, and
 *    the practitioner ask this implements ("7-10yr average EPS") is the same
 *    range. Below seven the figure stops being the thing that was asked for.
 *  - US business cycles since 1945 have averaged roughly five and a half years
 *    peak to peak (NBER). A window shorter than that can sit entirely inside
 *    one expansion, in which case the "cycle average" is an average of peaks
 *    and normalizes nothing — a three-year average is the peak-earnings trap
 *    with extra steps.
 *  - Five years is already available from the ordinary statement
 *    subcollections. A five-year minimum here would add a new name for a number
 *    the app can already compute, which is the opposite of the point.
 *
 * A company below this threshold gets an explicit reason, never a number.
 */
export const MIN_NORMALIZED_YEARS = 7;

/**
 * Sectors where an average of reported net income does not describe the
 * business.
 *
 * Real Estate only, and it inherits the exclusion `pe_ttm` already carries (see
 * SECTOR_INAPPLICABLE_METRICS in sectorApplicability.ts): a REIT's reported
 * earnings are dominated by depreciation on properties that generally
 * appreciate. That distortion is structural, not cyclical — it is present in
 * every year at similar size — so averaging ten years of it does not cancel it,
 * it entrenches it ten years deep. The construct that would work here is a
 * normalized FFO, and the valuation-history records carry no depreciation line
 * to build one from.
 *
 * Financials are deliberately NOT excluded. `pe_ttm` is applicable to banks and
 * insurers today because net income is a real bottom line for them, and if
 * anything a through-the-cycle average is more useful there than elsewhere:
 * credit losses are the most cyclical item a bank reports, provisions are
 * released at the top of a cycle and taken at the bottom, so a trailing P/E on
 * a bank is the peak-earnings trap in its purest form.
 */
export const NORMALIZED_EARNINGS_EXCLUDED_SECTORS = ["Real Estate"];

const EXCLUDED_SECTOR_REASON =
  "reported earnings for a property owner are dominated by depreciation on assets that generally appreciate, and that charge is present in every year rather than varying with a cycle — so averaging the years does not remove it, and the average describes the accounting rather than mid-cycle earning power";

export const NOMINAL_BASIS_NOTE =
  "These are reported dollars of each year, not adjusted for inflation. A Shiller-style cyclically-adjusted figure deflates each year by CPI first; no inflation series is available here, so older years count in their own smaller dollars. That pulls the average down and the multiple built on it up, by roughly the cumulative inflation over the window.";

/** Share-count drift across the window beyond which the aggregate framing is worth flagging. */
const SHARE_COUNT_DRIFT_CAVEAT_THRESHOLD = 0.15;

export interface NormalizedEarningsWindow {
  /** Fiscal years actually averaged, ascending. */
  fiscalYears: number[];
  years: number;
  firstFiscalYear: number;
  lastFiscalYear: number;
  /** e.g. "9y average, FY2016-FY2025" (an en dash in the real string). */
  label: string;
  /** True when the span covers more calendar years than there are observations — a year is missing inside the window. */
  hasGaps: boolean;
}

export interface NormalizedEarningsObservation {
  fiscalYear: number;
  netIncome: number;
  /** netIncome / revenue for that year, or null when revenue is missing or not positive. */
  margin: number | null;
}

export interface NormalizedEarningsReport {
  status: "ok" | "insufficient" | "not-applicable";
  /** Plain-language explanation whenever status is not "ok"; null when it is. */
  reason: string | null;
  window: NormalizedEarningsWindow | null;
  observations: NormalizedEarningsObservation[];

  /** Arithmetic mean of reported annual net income across the window. Loss years are included, at their negative value. */
  normalizedEarnings: number | null;
  latestEarnings: number | null;
  latestFiscalYear: number | null;

  /** Market cap over normalized earnings — price against mid-cycle earnings rather than against the last twelve months. */
  capeRatio: number | null;
  capeReason: string | null;

  /** Latest annual net income as a multiple of the normalized figure. Above 1 means the latest year earned more than the business's own average. */
  earningsVsNormalized: number | null;
  earningsVsNormalizedReason: string | null;

  /** Mean of the annual net margins across the window — an average of ratios, so no single large year dominates it. */
  normalizedMargin: number | null;
  normalizedMarginYears: number;
  latestMargin: number | null;
  marginReason: string | null;

  /** The inflation caveat, always populated — callers must render it. */
  basisNote: string;
  /** Everything else the reader needs to know about this particular company's figure. */
  caveats: string[];
}

export interface NormalizedEarningsInput {
  /** Ordinary market cap (not public float). Null suppresses the multiple, not the average. */
  currentMarketCap: number | null;
  sector?: string | null;
  /**
   * Set when the "market cap" is really EDGAR's public float (the price
   * ingestion fallback, LatestSnapshot.priceSource === "sec_public_float"): it
   * excludes affiliate-held shares, so the multiple built from it runs low.
   */
  currentMarketCapIsPublicFloat?: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function windowLabel(fiscalYears: number[]): string {
  const first = fiscalYears[0];
  const last = fiscalYears[fiscalYears.length - 1];
  return `${fiscalYears.length}y average, FY${first}–FY${last}`;
}

/**
 * The most recent up to MAX_NORMALIZED_WINDOW_YEARS fiscal years that report a
 * usable net income, ascending.
 *
 * Years without a net income are dropped rather than treated as zero — a zero
 * would be an invented observation pulling the average toward it. A year is
 * kept when net income is present whatever its sign: excluding loss years is
 * precisely how a "normalized" figure gets quietly turned back into a
 * peak-earnings figure.
 */
export function selectNormalizedWindow(entries: ValuationHistoryEntry[]): NormalizedEarningsObservation[] {
  const byYear = new Map<number, NormalizedEarningsObservation>();
  for (const entry of entries) {
    if (!isNumber(entry.fiscalYear) || !isNumber(entry.netIncome)) continue;
    byYear.set(entry.fiscalYear, {
      fiscalYear: entry.fiscalYear,
      netIncome: entry.netIncome,
      margin: isNumber(entry.revenue) && entry.revenue > 0 ? entry.netIncome / entry.revenue : null,
    });
  }
  return [...byYear.values()]
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .slice(-MAX_NORMALIZED_WINDOW_YEARS);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyReport(
  status: "insufficient" | "not-applicable",
  reason: string,
  observations: NormalizedEarningsObservation[] = [],
): NormalizedEarningsReport {
  return {
    status,
    reason,
    window: null,
    observations,
    normalizedEarnings: null,
    latestEarnings: null,
    latestFiscalYear: null,
    capeRatio: null,
    capeReason: null,
    earningsVsNormalized: null,
    earningsVsNormalizedReason: null,
    normalizedMargin: null,
    normalizedMarginYears: 0,
    latestMargin: null,
    marginReason: null,
    basisNote: NOMINAL_BASIS_NOTE,
    caveats: [],
  };
}

/** Share count at the two ends of the window, when both are on file, for the aggregate-vs-per-share caveat. */
function shareCountDrift(entries: ValuationHistoryEntry[], window: NormalizedEarningsWindow): number | null {
  const inWindow = entries
    .filter((e) => e.fiscalYear >= window.firstFiscalYear && e.fiscalYear <= window.lastFiscalYear)
    .filter((e) => isNumber(e.sharesOutstanding) && (e.sharesOutstanding as number) > 0)
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (inWindow.length < 2) return null;
  const first = inWindow[0].sharesOutstanding as number;
  const last = inWindow[inWindow.length - 1].sharesOutstanding as number;
  return (last - first) / first;
}

export function computeNormalizedEarnings(
  entries: ValuationHistoryEntry[],
  input: NormalizedEarningsInput,
): NormalizedEarningsReport {
  const sector = canonicalSector(input.sector ?? null);
  if (sector !== null && NORMALIZED_EARNINGS_EXCLUDED_SECTORS.includes(sector)) {
    return emptyReport("not-applicable", EXCLUDED_SECTOR_REASON);
  }

  const observations = selectNormalizedWindow(entries);
  if (observations.length < MIN_NORMALIZED_YEARS) {
    return emptyReport(
      "insufficient",
      `${observations.length} fiscal ${observations.length === 1 ? "year of" : "years of"} annual earnings ${
        observations.length === 1 ? "is" : "are"
      } on file, and at least ${MIN_NORMALIZED_YEARS} are needed before an average spans a business cycle rather than a stretch of one`,
      observations,
    );
  }

  const fiscalYears = observations.map((o) => o.fiscalYear);
  const firstFiscalYear = fiscalYears[0];
  const lastFiscalYear = fiscalYears[fiscalYears.length - 1];
  const window: NormalizedEarningsWindow = {
    fiscalYears,
    years: fiscalYears.length,
    firstFiscalYear,
    lastFiscalYear,
    label: windowLabel(fiscalYears),
    hasGaps: lastFiscalYear - firstFiscalYear + 1 > fiscalYears.length,
  };

  const normalizedEarnings = mean(observations.map((o) => o.netIncome));
  const latest = observations[observations.length - 1];

  const marketCap = isNumber(input.currentMarketCap) && input.currentMarketCap > 0 ? input.currentMarketCap : null;
  let capeRatio: number | null = null;
  let capeReason: string | null = null;
  if (normalizedEarnings <= 0) {
    capeReason = `this company's ${window.years} available years average out to a loss, and a price divided by a negative number is not a multiple`;
  } else if (marketCap === null) {
    capeReason = "no current market value is on file for this company, so there is nothing to divide by the average";
  } else {
    capeRatio = marketCap / normalizedEarnings;
  }

  let earningsVsNormalized: number | null = null;
  let earningsVsNormalizedReason: string | null = null;
  if (normalizedEarnings <= 0) {
    earningsVsNormalizedReason =
      "the average of these years is not positive, so the latest year cannot be expressed as a multiple of it";
  } else {
    earningsVsNormalized = latest.netIncome / normalizedEarnings;
  }

  const margins = observations.map((o) => o.margin).filter((m): m is number => m !== null);
  const normalizedMargin = margins.length >= MIN_NORMALIZED_YEARS ? mean(margins) : null;
  const marginReason =
    normalizedMargin === null
      ? `only ${margins.length} of these ${window.years} years report both earnings and revenue, and at least ${MIN_NORMALIZED_YEARS} are needed for a mid-cycle margin`
      : null;

  const caveats: string[] = [];
  if (window.years < MAX_NORMALIZED_WINDOW_YEARS) {
    caveats.push(
      `The window is ${window.years} years, not ${MAX_NORMALIZED_WINDOW_YEARS} — that is every year on file for this company. A shorter window covers less of a cycle.`,
    );
  }
  if (window.hasGaps) {
    caveats.push(
      `FY${firstFiscalYear}–FY${lastFiscalYear} spans ${lastFiscalYear - firstFiscalYear + 1} years but only ${window.years} of them report earnings, so the average is not of consecutive years.`,
    );
  }
  const lossYears = observations.filter((o) => o.netIncome < 0).length;
  if (lossYears > 0) {
    caveats.push(
      `${lossYears} of the ${window.years} years ${lossYears === 1 ? "is a loss and is" : "are losses and are"} included at ${lossYears === 1 ? "its" : "their"} negative value — the average is of what the business actually reported, not of its profitable years.`,
    );
  }
  const drift = shareCountDrift(entries, window);
  if (drift !== null && Math.abs(drift) >= SHARE_COUNT_DRIFT_CAVEAT_THRESHOLD) {
    caveats.push(
      `The share count ${drift > 0 ? "rose" : "fell"} about ${Math.abs(Math.round(drift * 100))}% across this window. These figures are company totals, not per-share, so that change is in the market value on top but not in the earnings average.`,
    );
  }
  if (input.currentMarketCapIsPublicFloat && capeRatio !== null) {
    caveats.push(
      "No live quote was available, so the current value used here is EDGAR's public float, which counts only shares held by non-affiliates. The multiple therefore reads lower than one built on a full market cap.",
    );
  }

  return {
    status: "ok",
    reason: null,
    window,
    observations,
    normalizedEarnings,
    latestEarnings: latest.netIncome,
    latestFiscalYear: latest.fiscalYear,
    capeRatio,
    capeReason,
    earningsVsNormalized,
    earningsVsNormalizedReason,
    normalizedMargin,
    normalizedMarginYears: margins.length,
    latestMargin: latest.margin,
    marginReason,
    basisNote: NOMINAL_BASIS_NOTE,
    caveats,
  };
}
