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

/** Gross profit / total assets (Novy-Marx, 2013). Deliberately NOT scaled by revenue — the point of the ratio is profit per dollar of assets employed, which is why it behaves differently from gross margin. */
export const grossProfitability: MetricCalculator = (i) => safeDiv(i.current.income.grossProfit, i.current.balance.totalAssets);
