import type { MetricCalculator } from "../types.js";
import { coefficientOfVariation, safeDiv } from "../util.js";
import { grossMarginOf, operatingMarginOf } from "../periodMath.js";

/** (Net Income - Operating Cash Flow) / Total Assets. Lower (or negative) is higher quality. */
export const accrualRatio: MetricCalculator = (i) => {
  const { netIncome } = i.current.income;
  const { operatingCashFlow } = i.current.cashFlow;
  if (netIncome === null || operatingCashFlow === null) return null;
  return safeDiv(netIncome - operatingCashFlow, i.current.balance.totalAssets);
};

/** 1 if FCF exceeds reported net income (cash-backed earnings), else 0. */
export const fcfExceedsNetIncome: MetricCalculator = (i) => {
  const { freeCashFlow } = i.current.cashFlow;
  const { netIncome } = i.current.income;
  if (freeCashFlow === null || netIncome === null) return null;
  return freeCashFlow > netIncome ? 1 : 0;
};

export const grossMarginStability: MetricCalculator = (i) => {
  const cv = coefficientOfVariation(i.series.map(grossMarginOf));
  return cv === null ? null : 1 / (1 + cv);
};

export const operatingMarginStability: MetricCalculator = (i) => {
  const cv = coefficientOfVariation(i.series.map(operatingMarginOf));
  return cv === null ? null : 1 / (1 + cv);
};

export const revenueVolatility: MetricCalculator = (i) => coefficientOfVariation(i.series.map((s) => s.income.revenue));

export const epsVolatility: MetricCalculator = (i) =>
  coefficientOfVariation(i.series.map((s) => s.income.epsDiluted ?? s.income.eps));
