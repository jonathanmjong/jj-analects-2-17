import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";

export const operatingCashFlowMargin: MetricCalculator = (i) =>
  safeDiv(i.current.cashFlow.operatingCashFlow, i.current.income.revenue);
export const fcfToRevenue: MetricCalculator = (i) => safeDiv(i.current.cashFlow.freeCashFlow, i.current.income.revenue);
export const fcfToNetIncome: MetricCalculator = (i) => safeDiv(i.current.cashFlow.freeCashFlow, i.current.income.netIncome);
export const cashConversionRatio: MetricCalculator = (i) =>
  safeDiv(i.current.cashFlow.operatingCashFlow, i.current.income.netIncome);
