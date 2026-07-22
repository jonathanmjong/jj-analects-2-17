import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";

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
export const shareholderYield: MetricCalculator = (i) => {
  const { dividendsPaid, stockBuybacks, stockIssuance } = i.current.cashFlow;
  if (i.marketCap === null || i.marketCap === 0) return null;
  const returned = Math.abs(dividendsPaid ?? 0) + Math.abs(stockBuybacks ?? 0) - Math.abs(stockIssuance ?? 0);
  return returned / i.marketCap;
};
