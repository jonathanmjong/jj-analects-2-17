import type { MetricCalculator } from "../types.js";
import { average, safeDiv } from "../util.js";
import { grossMarginOf, operatingMarginOf, roicOf } from "../periodMath.js";

export const avgRoic5y: MetricCalculator = (i) => average(i.series.slice(0, 5).map(roicOf));
export const avgGrossMargin5y: MetricCalculator = (i) => average(i.series.slice(0, 5).map(grossMarginOf));
export const avgOperatingMargin5y: MetricCalculator = (i) => average(i.series.slice(0, 5).map(operatingMarginOf));
export const rndToRevenue: MetricCalculator = (i) =>
  safeDiv(i.current.income.researchAndDevelopment, i.current.income.revenue);
export const intangibleAssetsPct: MetricCalculator = (i) => {
  const { intangibleAssets, goodwill, totalAssets } = i.current.balance;
  if (intangibleAssets === null && goodwill === null) return null;
  return safeDiv((intangibleAssets ?? 0) + (goodwill ?? 0), totalAssets);
};
