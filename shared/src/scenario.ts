/**
 * Two estimate-free ways to think about future value, both pure math so the
 * company page can run them client-side (same rule as valuation.ts):
 *
 *  - growth measured against return on invested capital, as a picture of what
 *    the company's own reinvestment has actually earned. Deliberately no
 *    composite score: the spread between ROIC and any cost of capital is
 *    usually inside the estimation error of both, so the chart is narrative,
 *    not a ranking input.
 *  - a three-input scenario (growth, operating margin, exit multiple) that
 *    turns the user's own assumptions into an implied price. Every default it
 *    supplies is the company's past or a stated convention — never a forecast.
 */

import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "./financials.js";

/**
 * Used when a filer's own effective rate is unusable (loss year, missing tax
 * line). A convention roughly at the US statutory federal rate plus typical
 * state tax — not an estimate of this company's future rate. Shared with
 * capitalAllocation.ts so the two panels can never quietly disagree.
 */
import { DEFAULT_EFFECTIVE_TAX_RATE } from "./capitalAllocation.js";
/** A single year's true-up, NOL release or valuation-allowance swing can drive a reported rate far outside anything sustainable. */
export const TAX_RATE_BOUNDS = { min: 0, max: 0.5 };

/**
 * Below this share of total assets the invested-capital denominator is small
 * enough that ROIC says more about the balance-sheet structure (cash pile,
 * buyback-eroded equity) than about the returns the business earns, so the
 * year is reported as not measurable instead of as a huge number.
 */
export const MIN_INVESTED_CAPITAL_SHARE_OF_ASSETS = 0.1;

/**
 * The reference level drawn on the growth-vs-ROIC chart. A convention for
 * "roughly where a large-cap's cost of capital tends to sit," not an estimate
 * of any particular company's — the chart labels it as such.
 */
export const INDICATIVE_COST_OF_CAPITAL = 0.08;

export const DEFAULT_SCENARIO_YEARS = 5;
export const EXIT_PE_BOUNDS = { min: 8, max: 25 };
/** Where the exit-multiple suggestion lands when today's P/E cannot be computed — a convention, stated as one in the UI. */
export const EXIT_PE_FALLBACK = 15;
/** How far the exit multiple is swung for the bull/bear cases and the sensitivity test, since a multiple has no historical dispersion in this dataset (no long price history). */
export const EXIT_PE_SWING = 0.3;

export type RoicGuard = "insufficient-data" | "reinvestment-base-too-small" | null;

export interface GrowthRoicPoint {
  fiscalYear: number;
  /** Year-over-year revenue growth; null in the first ingested year or across a gap in fiscal years. */
  revenueGrowth: number | null;
  roic: number | null;
  investedCapital: number | null;
  guard: RoicGuard;
}

/** The filer's own effective rate where it is meaningful, clamped; the convention otherwise. */
export function effectiveTaxRate(statement: IncomeStatement): number {
  const { incomeTaxExpense, pretaxIncome } = statement;
  if (incomeTaxExpense === null || pretaxIncome === null || pretaxIncome <= 0) return DEFAULT_EFFECTIVE_TAX_RATE;
  const rate = incomeTaxExpense / pretaxIncome;
  if (!Number.isFinite(rate)) return DEFAULT_EFFECTIVE_TAX_RATE;
  return clamp(rate, TAX_RATE_BOUNDS.min, TAX_RATE_BOUNDS.max);
}

export interface RoicObservation {
  roic: number | null;
  investedCapital: number | null;
  guard: RoicGuard;
}

/**
 * NOPAT over invested capital, where invested capital is equity plus debt less
 * cash — the capital the business actually has at work. Null debt or cash is
 * read as "the filer reported none" rather than as missing, since only equity
 * is indispensable here; note that ingested `totalDebt` is long-term only, so
 * invested capital is understated for heavy revolver users.
 */
export function returnOnInvestedCapital(
  income: IncomeStatement,
  balance: BalanceSheet | undefined,
): RoicObservation {
  if (!balance || income.operatingIncome === null || balance.totalEquity === null) {
    return { roic: null, investedCapital: null, guard: "insufficient-data" };
  }

  const investedCapital = balance.totalEquity + (balance.totalDebt ?? 0) - (balance.cashAndEquivalents ?? 0);
  const floor = balance.totalAssets === null ? 0 : balance.totalAssets * MIN_INVESTED_CAPITAL_SHARE_OF_ASSETS;
  if (investedCapital <= 0 || investedCapital <= floor) {
    return { roic: null, investedCapital, guard: "reinvestment-base-too-small" };
  }

  const nopat = income.operatingIncome * (1 - effectiveTaxRate(income));
  return { roic: nopat / investedCapital, investedCapital, guard: null };
}

/** One point per ingested fiscal year, oldest first so a chart can connect them in time order. */
export function computeGrowthRoicSeries(income: IncomeStatement[], balance: BalanceSheet[]): GrowthRoicPoint[] {
  const sorted = [...income].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const balanceByYear = new Map(balance.map((sheet) => [sheet.fiscalYear, sheet]));

  return sorted.map((statement, index) => {
    const prior = index > 0 ? sorted[index - 1] : undefined;
    const comparable =
      prior !== undefined &&
      prior.fiscalYear === statement.fiscalYear - 1 &&
      prior.revenue !== null &&
      prior.revenue > 0 &&
      statement.revenue !== null;
    const observation = returnOnInvestedCapital(statement, balanceByYear.get(statement.fiscalYear));

    return {
      fiscalYear: statement.fiscalYear,
      revenueGrowth: comparable ? statement.revenue! / prior!.revenue! - 1 : null,
      roic: observation.roic,
      investedCapital: observation.investedCapital,
      guard: observation.guard,
    };
  });
}

export interface ScenarioInput {
  revenueBase: number;
  sharesOutstanding: number;
  sharePrice: number;
  growthRate: number;
  operatingMargin: number;
  exitPe: number;
  years?: number;
  taxRate?: number;
}

export interface ScenarioResult {
  status: "ok" | "unavailable";
  /** Why nothing was computed; null when status is "ok". */
  reason: string | null;
  impliedPrice: number | null;
  annualizedReturn: number | null;
  terminalRevenue: number | null;
  terminalEps: number | null;
}

/**
 * Revenue compounds at `growthRate` for `years`, the terminal year's revenue
 * earns `operatingMargin`, tax turns that into net income, and the market pays
 * `exitPe` for it. Three assumptions worth stating wherever the output is
 * shown: earnings per share use TODAY'S diluted share count (no buybacks, no
 * dilution, no share-based-compensation drag), interest expense is ignored
 * (operating income is taxed directly), and the return is price-only — no
 * dividends are added back.
 */
export function computeScenario(input: ScenarioInput): ScenarioResult {
  const {
    revenueBase,
    sharesOutstanding,
    sharePrice,
    growthRate,
    operatingMargin,
    exitPe,
    years = DEFAULT_SCENARIO_YEARS,
    taxRate = DEFAULT_EFFECTIVE_TAX_RATE,
  } = input;

  const unavailable = (reason: string): ScenarioResult => ({
    status: "unavailable",
    reason,
    impliedPrice: null,
    annualizedReturn: null,
    terminalRevenue: null,
    terminalEps: null,
  });

  if (!Number.isFinite(revenueBase) || revenueBase <= 0) return unavailable("there is no positive revenue base to grow");
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) return unavailable("no diluted share count is available");
  if (!Number.isFinite(sharePrice) || sharePrice <= 0) return unavailable("no share price is available to compare against");
  if (!Number.isFinite(growthRate) || growthRate <= -1) return unavailable("a growth rate at or below -100%/yr leaves no business to value");
  if (!Number.isFinite(operatingMargin) || operatingMargin < 0) {
    return unavailable("a negative operating margin gives negative terminal earnings, and an exit multiple on a loss means nothing");
  }
  if (!Number.isFinite(exitPe) || exitPe <= 0) return unavailable("an exit multiple must be positive");
  if (!Number.isFinite(years) || years < 1) return unavailable("the horizon must be at least one year");

  const terminalRevenue = revenueBase * (1 + growthRate) ** years;
  const terminalNetIncome = terminalRevenue * operatingMargin * (1 - clamp(taxRate, TAX_RATE_BOUNDS.min, TAX_RATE_BOUNDS.max));
  const terminalEps = terminalNetIncome / sharesOutstanding;
  const impliedPrice = terminalEps * exitPe;

  return {
    status: "ok",
    reason: null,
    impliedPrice,
    annualizedReturn: (impliedPrice / sharePrice) ** (1 / years) - 1,
    terminalRevenue,
    terminalEps,
  };
}

export interface DispersionBand {
  median: number;
  low: number;
  high: number;
  /** How many fiscal years the band is drawn from; 0 means the values below are conventions, not this company's past. */
  observations: number;
  basis: "history" | "convention";
}

export interface ScenarioDefaults {
  growth: DispersionBand;
  margin: DispersionBand;
  exitPe: { suggested: number; note: string };
}

/** Placeholders for a company with no usable history, labelled as conventions so the UI never presents them as the company's own past. */
const CONVENTIONAL_GROWTH = { median: 0.05, low: 0, high: 0.1 };
const CONVENTIONAL_MARGIN = { median: 0.1, low: 0.05, high: 0.15 };

export interface ScenarioMarketInput {
  sharePrice: number | null;
  sharesOutstanding: number | null;
}

/**
 * Trailing medians and the full high-low range of the ingested window, for
 * both the slider pre-fills and the dispersion shown beside them. The exit
 * multiple has no equivalent history here (no multi-year price series), so it
 * is anchored on today's multiple and labelled an assumption.
 */
export function scenarioDefaults(
  income: IncomeStatement[],
  cashFlow: CashFlowStatement[],
  market?: ScenarioMarketInput,
): ScenarioDefaults {
  const sorted = [...income].sort((a, b) => a.fiscalYear - b.fiscalYear);

  const growths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prior = sorted[i - 1];
    const current = sorted[i];
    if (prior.fiscalYear !== current.fiscalYear - 1) continue;
    if (prior.revenue === null || prior.revenue <= 0 || current.revenue === null) continue;
    growths.push(current.revenue / prior.revenue - 1);
  }

  const margins: number[] = [];
  for (const statement of sorted) {
    if (statement.revenue === null || statement.revenue <= 0 || statement.operatingIncome === null) continue;
    margins.push(statement.operatingIncome / statement.revenue);
  }

  return {
    growth: band(growths, CONVENTIONAL_GROWTH),
    margin: band(margins, CONVENTIONAL_MARGIN),
    exitPe: exitPeSuggestion(sorted, cashFlow, market),
  };
}

function band(values: number[], fallback: { median: number; low: number; high: number }): DispersionBand {
  if (values.length === 0) return { ...fallback, observations: 0, basis: "convention" };
  return {
    median: median(values),
    low: Math.min(...values),
    high: Math.max(...values),
    observations: values.length,
    basis: "history",
  };
}

function exitPeSuggestion(
  income: IncomeStatement[],
  cashFlow: CashFlowStatement[],
  market: ScenarioMarketInput | undefined,
): ScenarioDefaults["exitPe"] {
  const latest = income[income.length - 1];
  const netIncome = latest?.netIncome ?? null;
  const shares = market?.sharesOutstanding ?? latest?.sharesOutstandingDiluted ?? null;
  const price = market?.sharePrice ?? null;

  const currentPe =
    netIncome !== null && netIncome > 0 && shares !== null && shares > 0 && price !== null && price > 0
      ? (price * shares) / netIncome
      : null;

  const suggested = roundToHalf(clamp(currentPe ?? EXIT_PE_FALLBACK, EXIT_PE_BOUNDS.min, EXIT_PE_BOUNDS.max));
  const anchor =
    currentPe === null
      ? `today's P/E cannot be computed from the statements on file, so this starts at the ${EXIT_PE_FALLBACK}× convention`
      : `it starts from today's ${round(currentPe, 1)}× earnings multiple`;

  const conversion = cashConversion(income, cashFlow);
  const conversionNote =
    conversion === null || conversion >= 0.8
      ? ""
      : ` Reported earnings converted to free cash flow at about ${Math.round(conversion * 100)}% over the ingested window, and this model prices accounting earnings.`;

  return {
    suggested,
    note: `The exit multiple is an assumption, not data — ${anchor}, held inside ${EXIT_PE_BOUNDS.min}–${EXIT_PE_BOUNDS.max}×.${conversionNote}`,
  };
}

/** Median free-cash-flow-to-net-income conversion over the window; null when no year has both a positive profit and a cash flow figure. */
function cashConversion(income: IncomeStatement[], cashFlow: CashFlowStatement[]): number | null {
  const fcfByYear = new Map<number, number | null>();
  for (const statement of cashFlow) {
    const fcf =
      statement.freeCashFlow ??
      (statement.operatingCashFlow !== null && statement.capitalExpenditures !== null
        ? statement.operatingCashFlow - Math.abs(statement.capitalExpenditures)
        : null);
    fcfByYear.set(statement.fiscalYear, fcf);
  }

  const ratios: number[] = [];
  for (const statement of income) {
    const fcf = fcfByYear.get(statement.fiscalYear);
    if (fcf === null || fcf === undefined) continue;
    if (statement.netIncome === null || statement.netIncome <= 0) continue;
    ratios.push(fcf / statement.netIncome);
  }
  return ratios.length === 0 ? null : median(ratios);
}

export type ScenarioDriver = "growth" | "margin" | "exitPe";

export interface DominantDriverInput {
  base: ScenarioInput;
  /** The plausible range each slider is moved across — the company's own historical low and high. */
  growth: { low: number; high: number };
  margin: { low: number; high: number };
  /** Fractional swing applied either side of the base exit multiple. */
  exitPeSwing?: number;
}

export interface DominantDriverResult {
  /** The input whose plausible range moves the annualized return furthest; null when nothing is computable. */
  driver: ScenarioDriver | null;
  spreads: Record<ScenarioDriver, number | null>;
}

/**
 * Which assumption is actually doing the work: move one input alone across its
 * plausible range, hold the others at the user's settings, and compare how far
 * the annualized return travels.
 */
export function dominantDriver(input: DominantDriverInput): DominantDriverResult {
  const swing = input.exitPeSwing ?? EXIT_PE_SWING;
  const spreads: Record<ScenarioDriver, number | null> = {
    growth: spreadOver(input.base, { growthRate: input.growth.low }, { growthRate: input.growth.high }),
    margin: spreadOver(input.base, { operatingMargin: input.margin.low }, { operatingMargin: input.margin.high }),
    exitPe: spreadOver(
      input.base,
      { exitPe: input.base.exitPe * (1 - swing) },
      { exitPe: input.base.exitPe * (1 + swing) },
    ),
  };

  let driver: ScenarioDriver | null = null;
  let widest = -Infinity;
  for (const key of ["growth", "margin", "exitPe"] as const) {
    const spread = spreads[key];
    if (spread === null || spread <= widest) continue;
    widest = spread;
    driver = key;
  }
  return { driver, spreads };
}

function spreadOver(base: ScenarioInput, low: Partial<ScenarioInput>, high: Partial<ScenarioInput>): number | null {
  const lowReturn = computeScenario({ ...base, ...low }).annualizedReturn;
  const highReturn = computeScenario({ ...base, ...high }).annualizedReturn;
  if (lowReturn === null || highReturn === null) return null;
  return Math.abs(highReturn - lowReturn);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
