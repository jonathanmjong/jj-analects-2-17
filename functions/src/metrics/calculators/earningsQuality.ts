import type { MetricCalculator } from "../types.js";
import { coefficientOfVariation, safeDiv } from "../util.js";
import { assetTurnoverOf, currentRatioOf, grossMarginOf, longTermLeverageOf, operatingMarginOf, roaOf } from "../periodMath.js";
import { computeNormalizedEarnings } from "@proverbs/shared";

/** (Net Income - Operating Cash Flow) / Total Assets. Lower (or negative) is higher quality. */
export const accrualRatio: MetricCalculator = (i) => {
  const { netIncome } = i.current.income;
  const { operatingCashFlow } = i.current.cashFlow;
  if (netIncome === null || operatingCashFlow === null) return null;
  return safeDiv(netIncome - operatingCashFlow, i.current.balance.totalAssets);
};

/**
 * Year-over-year change in total assets (Cooper, Gulen & Schill, 2008). Needs a prior fiscal year,
 * so it is null for a company with only one year of statements. A non-positive prior asset base
 * would make the percentage meaningless rather than merely extreme, so it is suppressed too.
 */
export const assetGrowth: MetricCalculator = (i) => {
  const current = i.current.balance.totalAssets;
  const prior = i.series[1]?.balance.totalAssets;
  if (current === null || prior === null || prior === undefined || prior <= 0) return null;
  return (current - prior) / prior;
};

/**
 * Net operating assets scaled by the prior year's total assets (Hirshleifer, Hou, Teoh & Zhang,
 * 2004) — balance-sheet bloat, i.e. how much of the asset base is accumulated operating accruals.
 *
 * The textbook construction subtracts financing items from both sides:
 *   operating assets      = total assets - cash and short-term investments
 *   operating liabilities = total assets - debt - minority interest - preferred - common equity
 * which cancels down to (equity + debt - cash), the form computed here. Two data limitations
 * follow from this dataset and are stated in the metric's description: `totalDebt` carries
 * long-term debt only (`shortTermDebt` is never populated), so short-term borrowings land on the
 * operating side and pull the ratio down; and minority interest / preferred stock aren't carried
 * at all, so they are not removed from the financing side. Short-term investments are excluded
 * from the cash deduction for the same reason roicOf() excludes them — the field is unreliable
 * here, and treating a missing value as zero would silently overstate the ratio.
 */
export const netOperatingAssets: MetricCalculator = (i) => {
  const priorTotalAssets = i.series[1]?.balance.totalAssets;
  if (priorTotalAssets === null || priorTotalAssets === undefined || priorTotalAssets <= 0) return null;
  const { totalEquity, totalDebt, cashAndEquivalents } = i.current.balance;
  if (totalEquity === null || totalDebt === null || cashAndEquivalents === null) return null;
  return (totalEquity + totalDebt - cashAndEquivalents) / priorTotalAssets;
};

/**
 * Share-based compensation as a share of revenue — what the dilution shown by `share_count_change`
 * actually costs, scaled to the size of the business.
 *
 * `?? null` rather than a direct null check: the field is optional on CashFlowStatement, so a
 * statement written before it existed reads back as undefined, and undefined must behave exactly
 * like null here (a filer that reports no SBC is not a filer with zero SBC).
 *
 * Revenue must be strictly positive, not merely non-zero: a negative revenue figure would flip the
 * ratio's sign and rank a company with heavy SBC as if it had none.
 */
export const sbcToRevenue: MetricCalculator = (i) => {
  const sbc = i.current.cashFlow.shareBasedCompensation ?? null;
  const { revenue } = i.current.income;
  if (sbc === null || revenue === null || revenue <= 0) return null;
  return sbc / revenue;
};

/**
 * Share-based compensation as a share of free cash flow — the sharper of the two, because free
 * cash flow is itself overstated by exactly this number: SBC is added back to operating cash flow
 * as non-cash, so a company paying a large part of its payroll in stock reports free cash flow it
 * never had to fund in cash.
 *
 * Non-positive free cash flow is SUPPRESSED, not ranked. The metric is "asc" (lower is better), so
 * a negative denominator would produce a negative ratio and hand a cash-burning company the best
 * score in the universe, while a near-zero denominator produces an arbitrarily large one — neither
 * is a reading the accounting supports. The suppression is not free: it drops exactly the
 * cash-burning companies where SBC matters most, which is why the metric carries a "caveat"
 * verdict (and therefore a reduced default weight) in shared/src/metricRationale.ts.
 */
export const sbcToFcf: MetricCalculator = (i) => {
  const sbc = i.current.cashFlow.shareBasedCompensation ?? null;
  const { freeCashFlow } = i.current.cashFlow;
  if (sbc === null || freeCashFlow === null || freeCashFlow <= 0) return null;
  return sbc / freeCashFlow;
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

/**
 * Piotroski F-Score (Piotroski, 2000) — a 9-point binary composite originally designed
 * specifically to separate improving from deteriorating LOW-P/B (classic value) stocks, exactly
 * this app's use case: 4 profitability checks, 3 leverage/liquidity/dilution checks, 2 operating
 * efficiency checks, each worth 1 point if true this year vs. last year (or, for the first two,
 * simply positive this year). Requires at least 6 of the 9 to be computable from available data —
 * a score built from only 2-3 available criteria isn't a meaningful F-Score, just noise dressed
 * up as one — and a full prior-year period to compare against, so returns null without both.
 */
export const piotroskiFScore: MetricCalculator = (i) => {
  const current = i.current;
  const prior = i.series[1];
  if (!prior) return null;

  const roaCur = roaOf(current);
  const roaPrior = roaOf(prior);
  const ocfCur = current.cashFlow.operatingCashFlow;
  const currentRatioCur = currentRatioOf(current);
  const currentRatioPrior = currentRatioOf(prior);
  const leverageCur = longTermLeverageOf(current);
  const leveragePrior = longTermLeverageOf(prior);
  const sharesCur = current.income.sharesOutstandingDiluted;
  const sharesPrior = prior.income.sharesOutstandingDiluted;
  const grossMarginCur = grossMarginOf(current);
  const grossMarginPrior = grossMarginOf(prior);
  const turnoverCur = assetTurnoverOf(current);
  const turnoverPrior = assetTurnoverOf(prior);

  let score = 0;
  let countable = 0;
  const add = (value: boolean | null) => {
    if (value === null) return;
    countable++;
    if (value) score++;
  };

  add(roaCur !== null ? roaCur > 0 : null); // 1. profitable this year
  add(ocfCur !== null ? ocfCur > 0 : null); // 2. positive operating cash flow
  add(roaCur !== null && roaPrior !== null ? roaCur > roaPrior : null); // 3. ROA improved
  add(ocfCur !== null && current.income.netIncome !== null ? ocfCur > current.income.netIncome : null); // 4. cash-backed earnings
  add(leverageCur !== null && leveragePrior !== null ? leverageCur < leveragePrior : null); // 5. leverage decreased
  add(currentRatioCur !== null && currentRatioPrior !== null ? currentRatioCur > currentRatioPrior : null); // 6. liquidity improved
  add(sharesCur !== null && sharesPrior !== null ? sharesCur <= sharesPrior : null); // 7. no new dilution
  add(grossMarginCur !== null && grossMarginPrior !== null ? grossMarginCur > grossMarginPrior : null); // 8. gross margin improved
  add(turnoverCur !== null && turnoverPrior !== null ? turnoverCur > turnoverPrior : null); // 9. asset turnover improved

  if (countable < 6) return null;
  return score;
};

/**
 * Latest annual earnings as a multiple of their own mid-cycle average — the
 * peak-cyclical tell. A reading well above 1 says the trailing P/E that makes
 * this company look cheap rests on earnings that are currently above trend.
 *
 * Suppressed when the latest year is a loss: the denominator is guarded
 * positive but the numerator is not, so under `direction: "asc"` (lower is
 * better) the deepest loss would otherwise rank best in the entire universe.
 */
export const earningsVsNormalized: MetricCalculator = (i) => {
  const report = computeNormalizedEarnings(i.valuationHistory, { currentMarketCap: i.marketCap });
  if (report.latestEarnings === null || report.latestEarnings < 0) return null;
  return report.earningsVsNormalized;
};
