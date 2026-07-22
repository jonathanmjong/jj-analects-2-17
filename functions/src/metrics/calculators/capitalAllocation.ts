import type { MetricCalculator } from "../types.js";
import { cagr, safeDiv } from "../util.js";

export const dividendYield: MetricCalculator = (i) => {
  const { dividendsPaid } = i.current.cashFlow;
  if (dividendsPaid === null || i.marketCap === null || i.marketCap === 0) return null;
  return Math.abs(dividendsPaid) / i.marketCap;
};

/** 3-year CAGR of dividends paid (absolute value); null for non-payers. */
export const dividendCagr: MetricCalculator = (i) => {
  const end = i.series[0]?.cashFlow.dividendsPaid;
  const start = i.series[3]?.cashFlow.dividendsPaid;
  if (end === null || end === undefined || start === null || start === undefined) return null;
  if (end === 0 || start === 0) return null;
  return cagr(Math.abs(end), Math.abs(start), 3);
};

export const buybackYield: MetricCalculator = (i) => {
  const { stockBuybacks } = i.current.cashFlow;
  if (stockBuybacks === null || i.marketCap === null || i.marketCap === 0) return null;
  return Math.abs(stockBuybacks) / i.marketCap;
};

export const shareholderYieldCapAlloc: MetricCalculator = (i) => {
  const { dividendsPaid, stockBuybacks, stockIssuance } = i.current.cashFlow;
  if (i.marketCap === null || i.marketCap === 0) return null;
  const returned = Math.abs(dividendsPaid ?? 0) + Math.abs(stockBuybacks ?? 0) - Math.abs(stockIssuance ?? 0);
  return returned / i.marketCap;
};

/** YoY % change in diluted share count; negative = shrinking share count (buybacks outpacing issuance). */
export const shareCountChange: MetricCalculator = (i) => {
  const current = i.series[0]?.income.sharesOutstandingDiluted;
  const prior = i.series[1]?.income.sharesOutstandingDiluted;
  if (current === null || current === undefined || prior === null || prior === undefined || prior === 0) return null;
  return (current - prior) / prior;
};

export const capexToRevenue: MetricCalculator = (i) => {
  const { capitalExpenditures } = i.current.cashFlow;
  if (capitalExpenditures === null) return null;
  return safeDiv(Math.abs(capitalExpenditures), i.current.income.revenue);
};
