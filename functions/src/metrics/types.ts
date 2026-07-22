import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";

export interface PeriodFinancials {
  income: IncomeStatement;
  balance: BalanceSheet;
  cashFlow: CashFlowStatement;
}

/**
 * Everything a metric calculator needs for one company/period. `series` is
 * the full available history (most recent first, series[0] === current) so
 * growth/CAGR/volatility calculators can look back without extra fetches.
 */
export interface MetricInput {
  ticker: string;
  periodKey: string;
  current: PeriodFinancials;
  series: PeriodFinancials[];
  marketCap: number | null;
  enterpriseValue: number | null;
  sharePrice: number | null;
  sharesOutstanding: number | null;
}

export type MetricCalculator = (input: MetricInput) => number | null;
