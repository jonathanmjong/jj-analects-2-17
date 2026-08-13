/**
 * Capital allocation read (F8): three descriptive pillars over the annual
 * statements — balance-sheet trajectory, reinvestment quality, shareholder
 * distributions. Pure math, no I/O, so the company page runs it client-side
 * and a server job could run the identical implementation — same rule as
 * valuation.ts and forensics.ts.
 *
 * It produces no grade and no verdict token. Every pillar states what the
 * accounting shows, at two significant figures, and leaves the judgement to
 * the reader. Where a figure cannot be supported by the statements on file the
 * point says so rather than rendering a number the data does not carry.
 *
 * Buyback *timing* against the company's own valuation history — the third
 * distribution test the research calls for — is absent here because it needs a
 * multi-year price series this project does not yet ingest.
 */

import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "./financials.js";

export type CapitalAllocationTrend = "improving" | "deteriorating" | "flat";

export interface CapitalAllocationPoint {
  label: string;
  value: string;
  /**
   * Set only where the direction of travel has one unambiguous reading — falling
   * net debt is an improvement, falling gross profitability is not. Points whose
   * direction is a matter of policy rather than of quality carry no trend.
   */
  trend?: CapitalAllocationTrend;
}

export type CapitalAllocationPillarKey = "balanceSheet" | "reinvestment" | "distributions";

export const CAPITAL_ALLOCATION_PILLAR_KEYS: CapitalAllocationPillarKey[] = [
  "balanceSheet",
  "reinvestment",
  "distributions",
];

export interface CapitalAllocationPillar {
  key: CapitalAllocationPillarKey;
  title: string;
  /** One descriptive sentence in plain language. Never a grade. */
  reading: string;
  points: CapitalAllocationPoint[];
  /** Present when the pillar is deliberately not read for this company, with the reason. */
  suppressed?: string;
}

export interface CapitalAllocationReport {
  pillars: CapitalAllocationPillar[];
  /** One neutral sentence composed from the pillar readings. Never a verdict. */
  summary: string;
}

export interface CapitalAllocationInput {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  sector: string | null;
}

/** Five fiscal years — the "5y trend" the panel names, four annual intervals of movement. */
const WINDOW_YEARS = 5;

/**
 * Applied to operating income when the filing's own tax lines cannot produce a
 * usable rate (a loss year, a tax credit, a missing line). 24% is the 21%
 * federal statutory rate plus a conventional state/foreign overlay — a
 * convention, not a measurement, which is why it is exported and disclosed
 * alongside any figure computed with it.
 */
export const DEFAULT_EFFECTIVE_TAX_RATE = 0.24;

/** Effective rates outside this band are artefacts of one-off items, not the tax the business pays. */
const TAX_RATE_BOUNDS = { min: 0, max: 0.5 };

/**
 * ΔNOPAT/ΔInvested capital is a ratio of two differences: when the denominator
 * is a rounding error on the capital base, ordinary year-to-year noise in
 * operating profit divides into it and prints a return of hundreds of percent.
 * Below this much movement in invested capital the ratio is not reported at all.
 */
export const MIN_INVESTED_CAPITAL_GROWTH = 0.15;

const NET_DEBT_FLAT_BAND = 0.1;
const COVERAGE_FLAT_BAND = 0.1;
/** Half a percentage point of gross profits per dollar of assets — inside this, the level has not moved. */
const GROSS_PROFITABILITY_FLAT_BAND = 0.005;
/** Half a percent of share count a year is buyback-versus-grant noise, not a policy. */
const SHARE_COUNT_FLAT_BAND = 0.005;

/** Borrowing is a bank's raw material rather than a strain on it, so leverage is not read as leverage here. */
const LEVERAGE_INAPPLICABLE_SECTORS = new Set(["Financials"]);

interface Period {
  fiscalYear: number;
  income: IncomeStatement | null;
  balance: BalanceSheet | null;
  cashFlow: CashFlowStatement | null;
}

interface Observation {
  year: number;
  value: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Two significant figures, the most any of these inputs supports. */
function twoSig(abs: number): string {
  return abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
}

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `${sign}$${twoSig(abs / scale)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function pct(fraction: number): string {
  const value = fraction * 100;
  const sign = value < 0 ? "-" : "";
  return `${sign}${twoSig(Math.abs(value))}%`;
}

function multiple(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? "-" : ""}${twoSig(abs)}x`;
}

function alignPeriods(input: CapitalAllocationInput): Period[] {
  const years = new Set<number>();
  for (const statement of [...input.income, ...input.balance, ...input.cashFlow]) {
    if (typeof statement?.fiscalYear === "number") years.add(statement.fiscalYear);
  }
  const incomeByYear = new Map(input.income.map((s) => [s.fiscalYear, s]));
  const balanceByYear = new Map(input.balance.map((s) => [s.fiscalYear, s]));
  const cashFlowByYear = new Map(input.cashFlow.map((s) => [s.fiscalYear, s]));

  return [...years]
    .sort((a, b) => b - a)
    .slice(0, WINDOW_YEARS)
    .map((fiscalYear) => ({
      fiscalYear,
      income: incomeByYear.get(fiscalYear) ?? null,
      balance: balanceByYear.get(fiscalYear) ?? null,
      cashFlow: cashFlowByYear.get(fiscalYear) ?? null,
    }));
}

/** Latest fiscal year first; years the accessor cannot value are dropped rather than zero-filled. */
function series(periods: Period[], accessor: (period: Period) => number | null): Observation[] {
  return periods
    .map((period) => ({ year: period.fiscalYear, value: accessor(period) }))
    .filter((observation): observation is Observation => observation.value !== null);
}

function relativeTrend(latest: number, start: number, fallingIsBetter: boolean, band: number): CapitalAllocationTrend {
  const scale = Math.max(Math.abs(latest), Math.abs(start));
  if (scale === 0) return "flat";
  const change = (latest - start) / scale;
  if (Math.abs(change) < band) return "flat";
  return (change < 0) === fallingIsBetter ? "improving" : "deteriorating";
}

function absoluteTrend(latest: number, start: number, fallingIsBetter: boolean, band: number): CapitalAllocationTrend {
  const change = latest - start;
  if (Math.abs(change) < band) return "flat";
  return (change < 0) === fallingIsBetter ? "improving" : "deteriorating";
}

/**
 * Long-term debt less cash. Both lines are required: totalDebt as ingested is
 * long-term debt only (neither provider carries short-term debt), and standing
 * a missing line in as zero would print a net-cash position for a company whose
 * borrowings simply were not parsed.
 */
function netDebtOf(balance: BalanceSheet | null): number | null {
  const totalDebt = finite(balance?.totalDebt);
  const cash = finite(balance?.cashAndEquivalents);
  if (totalDebt === null || cash === null) return null;
  return totalDebt - cash;
}

function investedCapitalOf(balance: BalanceSheet | null): number | null {
  const equity = finite(balance?.totalEquity);
  const totalDebt = finite(balance?.totalDebt);
  const cash = finite(balance?.cashAndEquivalents);
  if (equity === null || totalDebt === null || cash === null) return null;
  return equity + totalDebt - cash;
}

interface TaxRate {
  rate: number;
  fromFilings: boolean;
}

function effectiveTaxRate(income: IncomeStatement | null): TaxRate {
  const tax = finite(income?.incomeTaxExpense);
  const pretax = finite(income?.pretaxIncome);
  if (tax === null || pretax === null || pretax <= 0) {
    return { rate: DEFAULT_EFFECTIVE_TAX_RATE, fromFilings: false };
  }
  return { rate: clamp(Math.abs(tax) / pretax, TAX_RATE_BOUNDS.min, TAX_RATE_BOUNDS.max), fromFilings: true };
}

function nopatOf(income: IncomeStatement | null): number | null {
  const operatingIncome = finite(income?.operatingIncome);
  if (operatingIncome === null) return null;
  return operatingIncome * (1 - effectiveTaxRate(income).rate);
}

function freeCashFlowOf(cashFlow: CashFlowStatement | null): number | null {
  const reported = finite(cashFlow?.freeCashFlow);
  if (reported !== null) return reported;
  const operating = finite(cashFlow?.operatingCashFlow);
  const capex = finite(cashFlow?.capitalExpenditures);
  if (operating === null || capex === null) return null;
  return operating - Math.abs(capex);
}

function levelText(value: number): string {
  return value <= 0 ? `net cash of ${money(-value)}` : money(value);
}

function netDebtText(value: number): string {
  return value <= 0 ? `net cash of ${money(-value)}` : `net debt of ${money(value)}`;
}

function sentence(clauses: string[], joiner: string): string {
  const [first, ...rest] = clauses;
  return `${[`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(joiner)}.`;
}

function directionWord(latest: number, start: number, trend: CapitalAllocationTrend): string {
  if (trend === "flat") return "little changed from";
  return latest < start ? "down from" : "up from";
}

function balanceSheetPillar(periods: Period[], sector: string | null): CapitalAllocationPillar {
  const title = "Balance-sheet trajectory";
  if (sector !== null && LEVERAGE_INAPPLICABLE_SECTORS.has(sector)) {
    return {
      key: "balanceSheet",
      title,
      reading: "Leverage is not read for this sector.",
      points: [],
      suppressed: `Borrowing is raw material for a ${sector} company rather than a strain on it — net debt, debt-to-earnings and interest coverage would describe the business model instead of the balance sheet, so they are withheld.`,
    };
  }

  const points: CapitalAllocationPoint[] = [];
  const clauses: string[] = [];

  const netDebt = series(periods, (period) => netDebtOf(period.balance));
  if (netDebt.length > 0) {
    const latest = netDebt[0];
    const start = netDebt[netDebt.length - 1];
    const trend =
      netDebt.length > 1 ? relativeTrend(latest.value, start.value, true, NET_DEBT_FLAT_BAND) : undefined;
    points.push({
      label: "Net debt (long-term debt less cash)",
      value:
        trend === undefined
          ? levelText(latest.value)
          : `${levelText(latest.value)}, from ${levelText(start.value)} at FY${start.year}`,
      trend,
    });
    clauses.push(
      trend === undefined
        ? `The company carries ${netDebtText(latest.value)}`
        : `The company carries ${netDebtText(latest.value)}, ${directionWord(latest.value, start.value, trend)} ${levelText(start.value)} at FY${start.year}`,
    );
  }

  // EBITDA is null throughout this dataset, so the conventional net debt/EBITDA
  // ratio is run on operating income instead and labelled as the proxy it is.
  const leverage = series(periods, (period) => {
    const debt = netDebtOf(period.balance);
    const operatingIncome = finite(period.income?.operatingIncome);
    if (debt === null || debt <= 0 || operatingIncome === null || operatingIncome <= 0) return null;
    return debt / operatingIncome;
  });
  if (leverage.length > 0) {
    const latest = leverage[0];
    const start = leverage[leverage.length - 1];
    const hasWindow = leverage.length > 1;
    points.push({
      label: "Net debt / operating income (no EBITDA line is reported — operating income stands in)",
      value: hasWindow ? `${multiple(latest.value)}, from ${multiple(start.value)} at FY${start.year}` : multiple(latest.value),
      trend: hasWindow ? relativeTrend(latest.value, start.value, true, NET_DEBT_FLAT_BAND) : undefined,
    });
    clauses.push(`net debt is ${multiple(latest.value)} operating income`);
  }

  const coverage = series(periods, (period) => {
    const operatingIncome = finite(period.income?.operatingIncome);
    const interest = finite(period.income?.interestExpense);
    if (operatingIncome === null || interest === null || Math.abs(interest) === 0) return null;
    return operatingIncome / Math.abs(interest);
  });
  if (coverage.length > 0) {
    const latest = coverage[0];
    const start = coverage[coverage.length - 1];
    // A trend across a sign change is not a trend — a swing from -2x to 1x is a
    // different event from an improvement in coverage.
    const comparable = coverage.length > 1 && latest.value > 0 && start.value > 0;
    points.push({
      label: "Interest coverage (operating income / interest expense)",
      value:
        latest.value <= 0
          ? "operating income is negative — interest is not covered"
          : comparable
            ? `${multiple(latest.value)}, from ${multiple(start.value)} at FY${start.year}`
            : multiple(latest.value),
      trend: comparable ? relativeTrend(latest.value, start.value, false, COVERAGE_FLAT_BAND) : undefined,
    });
    clauses.push(
      latest.value <= 0
        ? "operating income does not cover the interest bill"
        : `operating income covers interest ${multiple(latest.value).replace("x", " times")}`,
    );
  }

  return {
    key: "balanceSheet",
    title,
    reading:
      clauses.length > 0
        ? sentence(clauses, "; ")
        : "The debt, cash and operating income lines this reads are not in the statements on file.",
    points,
  };
}

function reinvestmentPillar(periods: Period[]): CapitalAllocationPillar {
  const title = "Reinvestment quality";
  const points: CapitalAllocationPoint[] = [];
  const clauses: string[] = [];

  const grossProfitability = series(periods, (period) => {
    const grossProfit = finite(period.income?.grossProfit);
    const totalAssets = finite(period.balance?.totalAssets);
    if (grossProfit === null || totalAssets === null || totalAssets <= 0) return null;
    return grossProfit / totalAssets;
  });
  if (grossProfitability.length > 0) {
    const latest = grossProfitability[0];
    const start = grossProfitability[grossProfitability.length - 1];
    const trend =
      grossProfitability.length > 1
        ? absoluteTrend(latest.value, start.value, false, GROSS_PROFITABILITY_FLAT_BAND)
        : undefined;
    points.push({
      label: "Gross profits / total assets",
      value: trend === undefined ? pct(latest.value) : `${pct(latest.value)}, from ${pct(start.value)} at FY${start.year}`,
      trend,
    });
    clauses.push(
      trend === undefined
        ? `Gross profits equal ${pct(latest.value)} of total assets`
        : `Gross profits equal ${pct(latest.value)} of total assets, ${directionWord(latest.value, start.value, trend)} ${pct(start.value)} at FY${start.year}`,
    );
  }

  const capital = periods
    .map((period) => ({
      year: period.fiscalYear,
      invested: investedCapitalOf(period.balance),
      nopat: nopatOf(period.income),
    }))
    .filter((row): row is { year: number; invested: number; nopat: number } => row.invested !== null && row.nopat !== null);

  if (capital.length > 1) {
    const latest = capital[0];
    const start = capital[capital.length - 1];
    const addedCapital = latest.invested - start.invested;
    const measurable = start.invested > 0 && addedCapital > MIN_INVESTED_CAPITAL_GROWTH * start.invested;

    if (measurable) {
      const incremental = (latest.nopat - start.nopat) / addedCapital;
      const applied = effectiveTaxRate(periods[0]?.income ?? null);
      points.push({
        label: "Incremental return on new capital (after tax)",
        value: `${pct(incremental)} on ${money(addedCapital)} of capital added since FY${start.year}`,
      });
      points.push({
        label: "Tax rate applied to operating income",
        value: applied.fromFilings
          ? `${pct(applied.rate)}, from the FY${periods[0]?.fiscalYear} tax lines`
          : `${pct(applied.rate)} — a convention, used because the filings' own tax lines are unusable`,
      });
      clauses.push(
        `capital added since FY${start.year} has come back with ${pct(incremental)} in after-tax operating profit`,
      );
    } else {
      // Safeguard: the ratio exists arithmetically here but means nothing, so the
      // row states why rather than disappearing silently or printing the number.
      points.push({
        label: "Incremental return on new capital (after tax)",
        value: `not measured — reinvestment base too small to measure (invested capital moved less than ${pct(MIN_INVESTED_CAPITAL_GROWTH)} between FY${start.year} and FY${latest.year})`,
      });
    }
  }

  return {
    key: "reinvestment",
    title,
    reading:
      clauses.length > 0
        ? sentence(clauses, ", and ")
        : "The gross profit, asset and operating income lines this reads are not in the statements on file.",
    points,
  };
}

function distributionsPillar(periods: Period[]): CapitalAllocationPillar {
  const title = "Shareholder distributions";
  const points: CapitalAllocationPoint[] = [];
  const clauses: string[] = [];

  const latestPeriod = periods.find((period) => period.cashFlow !== null) ?? periods[0] ?? null;
  const fiscalYear = latestPeriod?.fiscalYear ?? null;
  const yearLabel = fiscalYear === null ? "the latest fiscal year" : `FY${fiscalYear}`;
  const freeCashFlow = freeCashFlowOf(latestPeriod?.cashFlow ?? null);
  const usableFcf = freeCashFlow !== null && freeCashFlow > 0 ? freeCashFlow : null;
  const ofFcf = (value: number): string => (usableFcf === null ? "" : `, ${pct(value / usableFcf)} of free cash flow`);

  const buybacks = finite(latestPeriod?.cashFlow?.stockBuybacks);
  const issuance = finite(latestPeriod?.cashFlow?.stockIssuance);
  // Providers disagree on the sign of these lines; magnitude is the only part
  // that is reliable, and the direction is fixed by which line it is.
  const netBuybacks = buybacks === null ? null : Math.abs(buybacks) - Math.abs(issuance ?? 0);
  if (netBuybacks !== null) {
    points.push({
      label: issuance === null ? "Buybacks (no stock issuance line is reported)" : "Buybacks net of issuance",
      value:
        netBuybacks >= 0
          ? `${money(netBuybacks)} in ${yearLabel}${ofFcf(netBuybacks)}`
          : `net issuance of ${money(-netBuybacks)} in ${yearLabel} — more stock was sold than bought back`,
    });
  }

  const dividends = finite(latestPeriod?.cashFlow?.dividendsPaid);
  if (dividends !== null) {
    const paid = Math.abs(dividends);
    points.push({
      label: "Dividends paid",
      value:
        paid === 0
          ? `none in ${yearLabel}`
          : freeCashFlow !== null && freeCashFlow <= 0
            ? `${money(paid)} in ${yearLabel}, against negative free cash flow`
            : `${money(paid)} in ${yearLabel}${ofFcf(paid)}`,
    });
  }

  const totalDistributions =
    dividends === null && netBuybacks === null ? null : Math.abs(dividends ?? 0) + Math.max(netBuybacks ?? 0, 0);
  let beyondFcf = false;
  if (totalDistributions !== null && freeCashFlow !== null) {
    beyondFcf = totalDistributions > freeCashFlow;
    points.push({
      label: "Dividends and net buybacks against free cash flow",
      value:
        usableFcf === null
          ? `${money(totalDistributions)} distributed in ${yearLabel} against negative free cash flow — funded beyond free cash flow`
          : `${pct(totalDistributions / usableFcf)} of ${money(freeCashFlow)} free cash flow${beyondFcf ? " — funded beyond free cash flow" : ""}`,
    });
    clauses.push(
      usableFcf === null
        ? `The company distributed ${money(totalDistributions)} in ${yearLabel} while free cash flow was negative`
        : `The company distributed ${money(totalDistributions)} in ${yearLabel}, ${pct(totalDistributions / usableFcf)} of free cash flow`,
    );
  }

  const shares = series(periods, (period) => {
    const count = finite(period.income?.sharesOutstandingDiluted);
    return count === null || count <= 0 ? null : count;
  });
  if (shares.length > 1) {
    const latest = shares[0];
    const start = shares[shares.length - 1];
    const years = latest.year - start.year;
    const cumulative = latest.value / start.value - 1;
    const perYear = years > 0 ? (latest.value / start.value) ** (1 / years) - 1 : cumulative;
    const trend = Math.abs(perYear) < SHARE_COUNT_FLAT_BAND ? "flat" : perYear < 0 ? "improving" : "deteriorating";
    points.push({
      label: "Diluted share count",
      value: `${pct(perYear)}/yr, ${pct(cumulative)} in total since FY${start.year}`,
      trend,
    });
    clauses.push(
      trend === "flat"
        ? "the diluted share count is broadly unchanged over the window"
        : `the diluted share count has ${perYear < 0 ? "fallen" : "risen"} ${pct(Math.abs(perYear))}/yr`,
    );
  }

  return {
    key: "distributions",
    title,
    reading:
      clauses.length > 0
        ? sentence(clauses, ", and ")
        : "The cash flow and share count lines this reads are not in the statements on file.",
    points,
  };
}

function summarize(pillars: CapitalAllocationPillar[]): string {
  const byKey = new Map(pillars.map((pillar) => [pillar.key, pillar]));
  const clauses: string[] = [];

  const balanceSheet = byKey.get("balanceSheet");
  if (balanceSheet?.suppressed) {
    clauses.push("leverage not read for this sector");
  } else {
    const netDebt = balanceSheet?.points.find((point) => point.label.startsWith("Net debt ("));
    if (netDebt?.trend === "improving") clauses.push("net debt falling");
    else if (netDebt?.trend === "deteriorating") clauses.push("net debt rising");
    else if (netDebt?.trend === "flat") clauses.push("net debt little changed");
  }

  const grossProfitability = byKey.get("reinvestment")?.points.find((point) => point.label === "Gross profits / total assets");
  if (grossProfitability?.trend === "improving") clauses.push("gross profitability rising");
  else if (grossProfitability?.trend === "deteriorating") clauses.push("gross profitability falling");
  else if (grossProfitability?.trend === "flat") clauses.push("gross profitability steady");

  const distributions = byKey.get("distributions");
  const coverage = distributions?.points.find((point) => point.label.startsWith("Dividends and net buybacks"));
  if (coverage) {
    clauses.push(
      coverage.value.includes("funded beyond free cash flow")
        ? "distributions funded beyond free cash flow"
        : "distributions covered by free cash flow",
    );
  }
  const shareCount = distributions?.points.find((point) => point.label === "Diluted share count");
  if (shareCount?.trend === "improving") clauses.push("share count falling");
  else if (shareCount?.trend === "deteriorating") clauses.push("share count rising");

  if (clauses.length === 0) return "The statements on file do not carry enough to read capital allocation.";
  return sentence(clauses, ", ");
}

export function computeCapitalAllocation(input: CapitalAllocationInput): CapitalAllocationReport {
  const periods = alignPeriods(input);
  const pillars = [balanceSheetPillar(periods, input.sector), reinvestmentPillar(periods), distributionsPillar(periods)];
  return { pillars, summary: summarize(pillars) };
}
