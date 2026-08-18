import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";
import { computeNormalizedEarnings } from "@proverbs/shared";

export const evToFcf: MetricCalculator = (i) => safeDiv(i.enterpriseValue, i.current.cashFlow.freeCashFlow);
export const evToEbit: MetricCalculator = (i) => safeDiv(i.enterpriseValue, i.current.income.ebit);
export const evToEbitda: MetricCalculator = (i) => safeDiv(i.enterpriseValue, i.current.income.ebitda);
export const peTtm: MetricCalculator = (i) => safeDiv(i.marketCap, i.current.income.netIncome);
export const priceToBook: MetricCalculator = (i) => safeDiv(i.marketCap, i.current.balance.totalEquity);
export const priceToSales: MetricCalculator = (i) => safeDiv(i.marketCap, i.current.income.revenue);
export const priceToTangibleBook: MetricCalculator = (i) => safeDiv(i.marketCap, i.current.balance.tangibleBookValue);
/** Greenblatt-style earnings yield: EBIT / Enterprise Value. */
export const earningsYield: MetricCalculator = (i) => safeDiv(i.current.income.ebit, i.enterpriseValue);
export const fcfYield: MetricCalculator = (i) => safeDiv(i.current.cashFlow.freeCashFlow, i.marketCap);
/**
 * APPROXIMATE funds from operations: net income plus depreciation and amortization.
 *
 * NAREIT's definition also subtracts gains on property sales and adds back impairments. This
 * dataset carries neither line item, so the figure below is an approximation and is described as
 * one everywhere it surfaces (metric description, rationale). It is not, and must not be
 * presented as, a reported FFO number: for a REIT that sold properties at a gain during the
 * period it reads high, since that one-off gain stays in net income.
 *
 * Null unless BOTH inputs are present — a missing D&A add-back would silently degrade to plain
 * net income, which is exactly the figure FFO exists to replace. Statements written before D&A
 * ingestion shipped therefore produce null here rather than a wrong number.
 */
export function approximateFfo(netIncome: number | null, depreciationAndAmortization: number | null | undefined): number | null {
  if (netIncome === null || depreciationAndAmortization === null || depreciationAndAmortization === undefined) return null;
  return netIncome + depreciationAndAmortization;
}

export const ffoYield: MetricCalculator = (i) => {
  const ffo = approximateFfo(i.current.income.netIncome, i.current.cashFlow.depreciationAndAmortization);
  if (ffo === null || i.marketCap === null || i.marketCap <= 0) return null;
  return ffo / i.marketCap;
};

/** Null on non-positive FFO: a negative price-to-FFO is not a cheaper REIT, it's an unpriceable one. */
export const priceToFfo: MetricCalculator = (i) => {
  const ffo = approximateFfo(i.current.income.netIncome, i.current.cashFlow.depreciationAndAmortization);
  if (ffo === null || ffo <= 0 || i.marketCap === null || i.marketCap <= 0) return null;
  return i.marketCap / ffo;
};

export const shareholderYield: MetricCalculator = (i) => {
  const { dividendsPaid, stockBuybacks, stockIssuance } = i.current.cashFlow;
  if (i.marketCap === null || i.marketCap === 0) return null;
  const returned = Math.abs(dividendsPaid ?? 0) + Math.abs(stockBuybacks ?? 0) - Math.abs(stockIssuance ?? 0);
  return returned / i.marketCap;
};

/**
 * Price against mid-cycle earnings instead of the last twelve months, so a
 * cyclical at peak margins stops screening cheap. Uses valuationHistory (~10
 * years) rather than `series`, which holds 5-6 — shorter than a business
 * cycle, and an average of one expansion normalizes nothing.
 *
 * Nominal, not CPI-deflated: older years count in smaller dollars, so the
 * average is biased low and this multiple correspondingly high. Disclosed in
 * the metric description and in the company panel.
 */
export const capeRatio: MetricCalculator = (i) => {
  const report = computeNormalizedEarnings(i.valuationHistory, { currentMarketCap: i.marketCap });
  return report.capeRatio;
};
