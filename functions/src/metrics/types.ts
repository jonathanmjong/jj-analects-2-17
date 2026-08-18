import type { BalanceSheet, CashFlowStatement, IncomeStatement, MomentumSnapshot, ValuationHistoryEntry } from "@proverbs/shared";

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
  /** Denormalized from companies/{ticker}.latest.momentum — null until priceHistoryRefresh has successfully fetched this ticker at least once. */
  momentum: MomentumSnapshot | null;
  /**
   * Up to ~12 annual observations from companies/{ticker}/valuationHistory,
   * most recent first, already truncated to end at THIS period's fiscal year.
   * `series` only carries 5-6 years, which is shorter than a business cycle —
   * anything cyclically-adjusted needs this longer history instead. Empty when
   * valuationHistoryRefresh has not reached this company yet.
   */
  valuationHistory: ValuationHistoryEntry[];
}

export type MetricCalculator = (input: MetricInput) => number | null;
