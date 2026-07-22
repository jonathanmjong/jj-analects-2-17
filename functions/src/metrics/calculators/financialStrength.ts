import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";

export const cashToMarketCap: MetricCalculator = (i) => safeDiv(i.current.balance.cashAndEquivalents, i.marketCap);
export const netCashToMarketCap: MetricCalculator = (i) => {
  const { cashAndEquivalents, totalDebt } = i.current.balance;
  if (cashAndEquivalents === null || totalDebt === null) return null;
  return safeDiv(cashAndEquivalents - totalDebt, i.marketCap);
};
export const debtToEquity: MetricCalculator = (i) => safeDiv(i.current.balance.totalDebt, i.current.balance.totalEquity);
export const currentRatio: MetricCalculator = (i) =>
  safeDiv(i.current.balance.totalCurrentAssets, i.current.balance.totalCurrentLiabilities);
export const quickRatio: MetricCalculator = (i) => {
  const { totalCurrentAssets, inventory, totalCurrentLiabilities } = i.current.balance;
  if (totalCurrentAssets === null) return null;
  return safeDiv(totalCurrentAssets - (inventory ?? 0), totalCurrentLiabilities);
};
export const interestCoverage: MetricCalculator = (i) => {
  const { interestExpense } = i.current.income;
  if (interestExpense === null || interestExpense === 0) return null;
  return safeDiv(i.current.income.ebit, Math.abs(interestExpense));
};
export const debtToEbitda: MetricCalculator = (i) => safeDiv(i.current.balance.totalDebt, i.current.income.ebitda);
/** Proxy for debt maturity profile: share of total debt that is long-term (higher = lower near-term refinancing risk). */
export const debtMaturityMix: MetricCalculator = (i) => safeDiv(i.current.balance.longTermDebt, i.current.balance.totalDebt);
