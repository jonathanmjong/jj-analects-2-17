import type { MetricCalculator, PeriodFinancials } from "../types.js";
import { cagr } from "../util.js";

type LineItem = "revenue" | "netIncome" | "eps" | "operatingCashFlow" | "freeCashFlow" | "bookValue";

function valueOf(pf: PeriodFinancials | undefined, item: LineItem): number | null {
  if (!pf) return null;
  switch (item) {
    case "revenue":
      return pf.income.revenue;
    case "netIncome":
      return pf.income.netIncome;
    case "eps":
      return pf.income.epsDiluted ?? pf.income.eps;
    case "operatingCashFlow":
      return pf.cashFlow.operatingCashFlow;
    case "freeCashFlow":
      return pf.cashFlow.freeCashFlow;
    case "bookValue":
      return pf.balance.totalEquity;
  }
}

/**
 * Builds a CAGR calculator for one line item over `years`. series[0] is the
 * current (most recent) period; series[years] is the period exactly `years`
 * back, assuming ingestion pulled a contiguous annual history.
 */
export function growthCalculator(item: LineItem, years: 1 | 3 | 5): MetricCalculator {
  return (input) => {
    const end = valueOf(input.series[0], item);
    const start = valueOf(input.series[years], item);
    return cagr(end, start, years);
  };
}

export const GROWTH_LINE_ITEMS: Array<{ item: LineItem; label: string }> = [
  { item: "revenue", label: "Revenue" },
  { item: "netIncome", label: "Net Income" },
  { item: "eps", label: "EPS" },
  { item: "operatingCashFlow", label: "Operating Cash Flow" },
  { item: "freeCashFlow", label: "Free Cash Flow" },
  { item: "bookValue", label: "Book Value" },
];

export const GROWTH_HORIZONS: Array<1 | 3 | 5> = [1, 3, 5];
