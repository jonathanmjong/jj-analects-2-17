import type { MetricCalculator } from "../types.js";
import { safeDiv } from "../util.js";

export const assetTurnover: MetricCalculator = (i) => safeDiv(i.current.income.revenue, i.current.balance.totalAssets);
export const inventoryTurnover: MetricCalculator = (i) =>
  safeDiv(i.current.income.costOfRevenue, i.current.balance.inventory);
export const receivableTurnover: MetricCalculator = (i) =>
  safeDiv(i.current.income.revenue, i.current.balance.receivables);

/** Days Inventory Outstanding + Days Sales Outstanding - Days Payables Outstanding. Lower is better. */
export const cashConversionCycle: MetricCalculator = (i) => {
  const { costOfRevenue, revenue } = i.current.income;
  const { inventory, receivables, accountsPayable } = i.current.balance;
  if (costOfRevenue === null || costOfRevenue === 0 || revenue === null || revenue === 0) return null;
  if (inventory === null || receivables === null || accountsPayable === null) return null;
  const dio = (365 * inventory) / costOfRevenue;
  const dso = (365 * receivables) / revenue;
  const dpo = (365 * accountsPayable) / costOfRevenue;
  return dio + dso - dpo;
};
