import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";
import { grossMarginOf, netMarginOf, operatingMarginOf, roicOf } from "../periodMath.js";

export const roic: MetricCalculator = (i) => roicOf(i.current);
export const roe: MetricCalculator = (i) => safeDiv(i.current.income.netIncome, i.current.balance.totalEquity);
export const roa: MetricCalculator = (i) => safeDiv(i.current.income.netIncome, i.current.balance.totalAssets);
export const grossMargin: MetricCalculator = (i) => grossMarginOf(i.current);
export const operatingMargin: MetricCalculator = (i) => operatingMarginOf(i.current);
export const netMargin: MetricCalculator = (i) => netMarginOf(i.current);
export const freeCashFlowMargin: MetricCalculator = (i) => safeDiv(i.current.cashFlow.freeCashFlow, i.current.income.revenue);
