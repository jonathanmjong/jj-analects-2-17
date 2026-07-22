import type { PeriodFinancials } from "./types.js";
import { safeDiv } from "./util.js";

/** Per-period ratios reused by both single-period calculators and the multi-year moat averages. */

export function grossMarginOf(pf: PeriodFinancials): number | null {
  return safeDiv(pf.income.grossProfit, pf.income.revenue);
}

export function operatingMarginOf(pf: PeriodFinancials): number | null {
  return safeDiv(pf.income.operatingIncome, pf.income.revenue);
}

export function netMarginOf(pf: PeriodFinancials): number | null {
  return safeDiv(pf.income.netIncome, pf.income.revenue);
}

/**
 * ROIC = NOPAT / Invested Capital, NOPAT = EBIT * (1 - effective tax rate).
 * Falls back to a 21% statutory-ish rate when pretax income / tax expense
 * aren't both available (common with SEC EDGAR gaps) rather than dropping
 * the metric entirely.
 */
export function roicOf(pf: PeriodFinancials): number | null {
  const { ebit, pretaxIncome, incomeTaxExpense } = pf.income;
  if (ebit === null) return null;

  let taxRate = 0.21;
  if (pretaxIncome !== null && pretaxIncome !== 0 && incomeTaxExpense !== null) {
    const impliedRate = incomeTaxExpense / pretaxIncome;
    if (impliedRate >= 0 && impliedRate <= 1) taxRate = impliedRate;
  }
  const nopat = ebit * (1 - taxRate);

  const { totalEquity, totalDebt, cashAndEquivalents } = pf.balance;
  if (totalEquity === null || totalDebt === null) return null;
  const investedCapital = totalEquity + totalDebt - (cashAndEquivalents ?? 0);
  return safeDiv(nopat, investedCapital);
}
