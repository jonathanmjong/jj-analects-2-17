/**
 * Reverse-DCF ("what growth is the market already paying for?") and the
 * business-consistency gate that decides whether that question is answerable
 * at all. Pure math, no I/O, so the company page can run it client-side and
 * the ranking pipeline can run the identical implementation if it ever needs
 * to — same rule as rankingMath.ts.
 */

import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "./financials.js";

export interface PerShareObservation {
  fiscalYear: number;
  value: number | null;
}

export interface ConsistencyResult {
  /** Residual coefficient of variation around a log-linear trend; null when there is too little usable history. */
  cv: number | null;
  usableYears: number;
}

const MIN_CONSISTENCY_YEARS = 4;

/**
 * Dispersion of a per-share series around its own exponential trendline: fit
 * ln(value) on fiscal year by ordinary least squares, then express the
 * residuals as a fraction of the series mean. Fitting in logs rather than
 * levels keeps a business that compounds steadily at 20%/yr from scoring as
 * "erratic" purely because its later years are larger in absolute dollars.
 * Only positive values are usable (a loss year has no logarithm), so a
 * business that dips negative loses years of history here — which is itself
 * the signal this gate exists to catch.
 */
export function computeConsistency(perShareSeries: PerShareObservation[]): ConsistencyResult {
  const usable = perShareSeries
    .filter((p): p is { fiscalYear: number; value: number } => p.value !== null && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

  if (usable.length < MIN_CONSISTENCY_YEARS) return { cv: null, usableYears: usable.length };

  const n = usable.length;
  const meanYear = usable.reduce((acc, p) => acc + p.fiscalYear, 0) / n;
  const logs = usable.map((p) => Math.log(p.value));
  const meanLog = logs.reduce((a, b) => a + b, 0) / n;

  const sxx = usable.reduce((acc, p) => acc + (p.fiscalYear - meanYear) ** 2, 0);
  if (sxx === 0) return { cv: null, usableYears: n };
  const sxy = usable.reduce((acc, p, idx) => acc + (p.fiscalYear - meanYear) * (logs[idx] - meanLog), 0);
  const slope = sxy / sxx;
  const intercept = meanLog - slope * meanYear;

  const meanValue = usable.reduce((acc, p) => acc + p.value, 0) / n;
  if (meanValue <= 0) return { cv: null, usableYears: n };

  // Denominator n, not the textbook n-2: with only 4-5 annual points the
  // degrees-of-freedom correction moves the estimate more than it corrects it.
  const sse = usable.reduce((acc, p) => acc + (p.value - Math.exp(intercept + slope * p.fiscalYear)) ** 2, 0);
  return { cv: Math.sqrt(sse / n) / meanValue, usableYears: n };
}

/**
 * Trend-deviation limits above which a business is treated as too erratic to
 * extrapolate. Revenue per share is the tighter test (0.25 ≈ typical years
 * landing within a quarter of trend) because revenue is the smoothest line on
 * the statement — a company whose *sales* wander that far from their own trend
 * has no trend worth solving a ten-year DCF against. Free cash flow gets much
 * more room (0.6) because lumpy capex, working-capital swings and one-off tax
 * payments move it far more than the underlying business moves; holding FCF to
 * the revenue limit would suppress the panel for most industrials.
 */
export const REVENUE_PER_SHARE_CV_LIMIT = 0.25;
export const FCF_PER_SHARE_CV_LIMIT = 0.6;

export interface PredictabilityAssessment {
  predictable: boolean;
  /** Plain-language explanation when not predictable; null when it is. */
  reason: string | null;
  revenueCv: number | null;
  fcfCv: number | null;
}

function freeCashFlowOf(statement: CashFlowStatement | undefined): number | null {
  if (!statement) return null;
  if (statement.freeCashFlow !== null) return statement.freeCashFlow;
  const { operatingCashFlow, capitalExpenditures } = statement;
  if (operatingCashFlow === null || capitalExpenditures === null) return null;
  return operatingCashFlow - Math.abs(capitalExpenditures);
}

/**
 * The gate (F4): is this business's own history stable enough that
 * extrapolating it for a decade is a defensible exercise? Per-share, so that
 * growth financed by share issuance does not read as growth.
 */
export function assessPredictability(
  income: IncomeStatement[],
  cashFlow: CashFlowStatement[],
): PredictabilityAssessment {
  const sharesByYear = new Map<number, number | null>();
  for (const statement of income) sharesByYear.set(statement.fiscalYear, statement.sharesOutstandingDiluted);

  const revenuePerShare: PerShareObservation[] = income.map((statement) => ({
    fiscalYear: statement.fiscalYear,
    value: perShare(statement.revenue, statement.sharesOutstandingDiluted),
  }));
  const fcfPerShare: PerShareObservation[] = cashFlow.map((statement) => ({
    fiscalYear: statement.fiscalYear,
    value: perShare(freeCashFlowOf(statement), sharesByYear.get(statement.fiscalYear) ?? null),
  }));

  const revenue = computeConsistency(revenuePerShare);
  const fcf = computeConsistency(fcfPerShare);
  const revenueCv = revenue.cv;
  const fcfCv = fcf.cv;

  if (revenueCv === null || fcfCv === null) {
    const thin: string[] = [];
    if (revenueCv === null) thin.push(`revenue per share (${revenue.usableYears} usable fiscal years)`);
    if (fcfCv === null) thin.push(`free cash flow per share (${fcf.usableYears} usable fiscal years)`);
    return {
      predictable: false,
      reason: `there is too little usable history to test consistency — ${thin.join(" and ")}, and at least ${MIN_CONSISTENCY_YEARS} positive years are needed.`,
      revenueCv,
      fcfCv,
    };
  }

  const erratic: string[] = [];
  if (revenueCv > REVENUE_PER_SHARE_CV_LIMIT) {
    erratic.push(`revenue per share (${cvText(revenueCv)} vs a ${cvText(REVENUE_PER_SHARE_CV_LIMIT)} limit)`);
  }
  if (fcfCv > FCF_PER_SHARE_CV_LIMIT) {
    erratic.push(`free cash flow per share (${cvText(fcfCv)} vs a ${cvText(FCF_PER_SHARE_CV_LIMIT)} limit)`);
  }
  if (erratic.length > 0) {
    return {
      predictable: false,
      reason: `this business's own history is too erratic to extrapolate — ${erratic.join(" and ")} ${erratic.length > 1 ? "wander" : "wanders"} too far from its own trendline.`,
      revenueCv,
      fcfCv,
    };
  }

  return { predictable: true, reason: null, revenueCv, fcfCv };
}

function perShare(value: number | null, shares: number | null | undefined): number | null {
  if (value === null || shares === null || shares === undefined || shares <= 0) return null;
  return value / shares;
}

function cvText(cv: number): string {
  return cv.toFixed(2);
}

export const DEFAULT_FADE_YEARS = 10;
export const DEFAULT_TERMINAL_GROWTH = 0.025;
export const DEFAULT_DISCOUNT_RATES = [0.08, 0.1, 0.12];
/** Outside this band the "implied growth" answer stops being a statement about the business. */
export const IMPLIED_GROWTH_BOUNDS = { min: -0.5, max: 0.6 };

export interface ImpliedGrowthInput {
  price: number;
  sharesOutstanding: number;
  /** Total debt minus cash; added to equity value because the projected FCF stream is firm-level. */
  netDebt: number;
  trailingFcf: number;
  discountRate: number;
  fadeYears?: number;
  terminalGrowth?: number;
}

function firmValue(
  growth: number,
  trailingFcf: number,
  discountRate: number,
  fadeYears: number,
  terminalGrowth: number,
): number {
  let fcf = trailingFcf;
  let pv = 0;
  for (let t = 1; t <= fadeYears; t++) {
    const yearGrowth = fadeYears === 1 ? growth : growth + (terminalGrowth - growth) * ((t - 1) / (fadeYears - 1));
    fcf *= 1 + yearGrowth;
    pv += fcf / (1 + discountRate) ** t;
  }
  const terminal = (fcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  return pv + terminal / (1 + discountRate) ** fadeYears;
}

/**
 * Back-solve the two-stage DCF identity for the stage-1 growth rate that makes
 * the model's enterprise value equal the market's. Stage 1 starts at g and
 * fades linearly to terminalGrowth by the final projected year; a Gordon
 * terminal value follows. Returns null rather than a clamped number when the
 * price implies growth outside IMPLIED_GROWTH_BOUNDS — a bounded answer the
 * data does not support is worse than no answer.
 */
export function solveImpliedGrowth(input: ImpliedGrowthInput): number | null {
  const {
    price,
    sharesOutstanding,
    netDebt,
    trailingFcf,
    discountRate,
    fadeYears = DEFAULT_FADE_YEARS,
    terminalGrowth = DEFAULT_TERMINAL_GROWTH,
  } = input;

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) return null;
  if (!Number.isFinite(netDebt)) return null;
  if (!Number.isFinite(trailingFcf) || trailingFcf <= 0) return null;
  if (!Number.isFinite(discountRate) || discountRate <= terminalGrowth) return null;
  if (!Number.isFinite(fadeYears) || fadeYears < 1) return null;

  const enterpriseValue = price * sharesOutstanding + netDebt;
  if (!Number.isFinite(enterpriseValue)) return null;

  const gap = (growth: number) => firmValue(growth, trailingFcf, discountRate, fadeYears, terminalGrowth) - enterpriseValue;

  let low = IMPLIED_GROWTH_BOUNDS.min;
  let high = IMPLIED_GROWTH_BOUNDS.max;
  const gapLow = gap(low);
  const gapHigh = gap(high);
  if (gapLow > 0 || gapHigh < 0) return null;

  for (let i = 0; i < 200 && high - low > 1e-10; i++) {
    const mid = (low + high) / 2;
    if (gap(mid) < 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export interface ImpliedGrowthPoint {
  discountRate: number;
  growth: number;
}

export interface RealizedGrowthWindow {
  /** Honest description of the window actually measured, e.g. "3y (FY2021 → FY2024)". */
  label: string;
  fcfCagr: number | null;
  revenueCagr: number | null;
}

export interface ReverseDcfAssumptions {
  discountRates: number[];
  fadeYears: number;
  terminalGrowth: number;
  growthBounds: { min: number; max: number };
  trailingFcf: number | null;
  fcfBasis: "latest fiscal year" | "average of the last two fiscal years" | null;
  fcfBasisYears: number[];
  netDebt: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  sharePrice: number | null;
  sharesOutstanding: number | null;
  equityValue: number | null;
  enterpriseValue: number | null;
  revenueCv: number | null;
  fcfCv: number | null;
  revenueCvLimit: number;
  fcfCvLimit: number;
  fiscalYears: number[];
}

export interface ReverseDcfResult {
  status: "ok" | "suppressed";
  reason?: string;
  implied?: ImpliedGrowthPoint[];
  realized: RealizedGrowthWindow[];
  assumptions: ReverseDcfAssumptions;
}

export interface ReverseDcfInput {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  sector: string | null;
  sharePrice: number | null;
  sharesOutstanding: number | null;
  discountRates?: number[];
  fadeYears?: number;
  terminalGrowth?: number;
}

/** Sectors whose economics an enterprise-value FCF model cannot describe: debt is raw material for one and the asset base is the business for the other. */
const EV_DCF_EXCLUDED_SECTORS = ["Financials", "Real Estate"];

/** One year's capex spike or working-capital swing can halve or double reported FCF without the business changing; beyond this gap the two years are averaged instead of extrapolating the accident. */
const FCF_BASE_SMOOTHING_GAP = 0.4;

export function computeReverseDcf(input: ReverseDcfInput): ReverseDcfResult {
  const income = [...input.income].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const balance = [...input.balance].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const cashFlow = [...input.cashFlow].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const discountRates = input.discountRates ?? DEFAULT_DISCOUNT_RATES;
  const fadeYears = input.fadeYears ?? DEFAULT_FADE_YEARS;
  const terminalGrowth = input.terminalGrowth ?? DEFAULT_TERMINAL_GROWTH;

  const latestFcf = freeCashFlowOf(cashFlow[0]);
  const priorFcf = freeCashFlowOf(cashFlow[1]);
  let trailingFcf = latestFcf;
  let fcfBasis: ReverseDcfAssumptions["fcfBasis"] = latestFcf === null ? null : "latest fiscal year";
  let fcfBasisYears = cashFlow[0] ? [cashFlow[0].fiscalYear] : [];
  if (
    latestFcf !== null &&
    priorFcf !== null &&
    Math.abs(latestFcf - priorFcf) / Math.max(Math.abs(latestFcf), Math.abs(priorFcf)) > FCF_BASE_SMOOTHING_GAP
  ) {
    trailingFcf = (latestFcf + priorFcf) / 2;
    fcfBasis = "average of the last two fiscal years";
    fcfBasisYears = [cashFlow[1].fiscalYear, cashFlow[0].fiscalYear];
  }

  // totalDebt as ingested is long-term debt only (short-term debt is null from
  // both providers), so net debt understates leverage for heavy revolver users.
  const totalDebt = balance[0]?.totalDebt ?? null;
  const cashAndEquivalents = balance[0]?.cashAndEquivalents ?? null;
  const netDebt = balance.length === 0 ? null : (totalDebt ?? 0) - (cashAndEquivalents ?? 0);

  const equityValue =
    input.sharePrice !== null && input.sharesOutstanding !== null ? input.sharePrice * input.sharesOutstanding : null;
  const enterpriseValue = equityValue !== null && netDebt !== null ? equityValue + netDebt : null;

  const predictability = assessPredictability(income, cashFlow);
  const realized = realizedWindows(income, cashFlow);

  const assumptions: ReverseDcfAssumptions = {
    discountRates,
    fadeYears,
    terminalGrowth,
    growthBounds: IMPLIED_GROWTH_BOUNDS,
    trailingFcf,
    fcfBasis,
    fcfBasisYears,
    netDebt,
    totalDebt,
    cashAndEquivalents,
    sharePrice: input.sharePrice,
    sharesOutstanding: input.sharesOutstanding,
    equityValue,
    enterpriseValue,
    revenueCv: predictability.revenueCv,
    fcfCv: predictability.fcfCv,
    revenueCvLimit: REVENUE_PER_SHARE_CV_LIMIT,
    fcfCvLimit: FCF_PER_SHARE_CV_LIMIT,
    fiscalYears: income.map((s) => s.fiscalYear),
  };
  const suppressed = (reason: string): ReverseDcfResult => ({ status: "suppressed", reason, realized, assumptions });

  if (input.sector !== null && EV_DCF_EXCLUDED_SECTORS.includes(input.sector)) {
    return suppressed("enterprise-value DCF is not meaningful for financial companies / REITs");
  }
  if (income.length === 0 || cashFlow.length === 0) {
    return suppressed("no annual statements have been ingested for this company yet");
  }
  if (input.sharePrice === null || input.sharePrice <= 0 || input.sharesOutstanding === null || input.sharesOutstanding <= 0) {
    return suppressed("no usable share price or share count is available for this company");
  }
  if (netDebt === null) {
    return suppressed("no balance sheet has been ingested, so net debt cannot be established");
  }
  if (trailingFcf === null) {
    return suppressed("free cash flow is missing from the latest cash flow statement");
  }
  if (trailingFcf <= 0) {
    return suppressed(
      "trailing free cash flow is negative, and discounting a negative cash stream produces a growth rate that means nothing",
    );
  }
  if (!predictability.predictable) {
    return suppressed(predictability.reason ?? "this business's history is too erratic to extrapolate");
  }

  const implied: ImpliedGrowthPoint[] = [];
  for (const discountRate of discountRates) {
    const growth = solveImpliedGrowth({
      price: input.sharePrice,
      sharesOutstanding: input.sharesOutstanding,
      netDebt,
      trailingFcf,
      discountRate,
      fadeYears,
      terminalGrowth,
    });
    // A partial band would read as a narrower range than the assumptions
    // actually support, so one unsolvable rate suppresses the whole panel.
    if (growth === null) {
      return suppressed(
        `at ${(discountRate * 100).toFixed(1)}% the price implies growth outside the ${(IMPLIED_GROWTH_BOUNDS.min * 100).toFixed(0)}% to ${(IMPLIED_GROWTH_BOUNDS.max * 100).toFixed(0)}% range this model will solve over`,
      );
    }
    implied.push({ discountRate, growth });
  }

  return { status: "ok", implied, realized, assumptions };
}

function cagr(startValue: number | null, endValue: number | null, years: number): number | null {
  if (startValue === null || endValue === null || years <= 0) return null;
  if (startValue <= 0 || endValue <= 0) return null;
  return (endValue / startValue) ** (1 / years) - 1;
}

/** Realized growth over 3 years and over whatever the full ingested window turns out to be — labelled as the window it actually is, never rounded up to "5y" or "10y". */
function realizedWindows(income: IncomeStatement[], cashFlow: CashFlowStatement[]): RealizedGrowthWindow[] {
  const years = income.length > 0 ? income.map((s) => s.fiscalYear) : cashFlow.map((s) => s.fiscalYear);
  if (years.length < 2) return [];
  const fullSpan = Math.min(income.length, cashFlow.length) - 1;
  const spans = [...new Set([3, fullSpan].filter((s) => s >= 1 && s <= years.length - 1))].sort((a, b) => a - b);

  return spans.map((span) => ({
    label: `${span}y (FY${years[span]} → FY${years[0]})`,
    fcfCagr: cagr(freeCashFlowOf(cashFlow[span]), freeCashFlowOf(cashFlow[0]), span),
    revenueCagr: cagr(income[span]?.revenue ?? null, income[0]?.revenue ?? null, span),
  }));
}
