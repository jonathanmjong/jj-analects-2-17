import type { BalanceSheet, CashFlowStatement, IncomeStatement, MetricScore } from "@proverbs/shared";
import { collections } from "../lib/firestore.js";
import type { MetricInput, PeriodFinancials } from "./types.js";
import { METRIC_CALCULATORS, METRIC_DEFINITIONS } from "./definitions.js";

const MAX_PERIODS = 6; // need N+1 statements to compute an N-year CAGR, and we cap growth horizons at 5

/**
 * Recomputes every enabled metric for every available fiscal year of one
 * company and writes companies/{ticker}/metricScores/{periodKey}.
 *
 * NOTE (known limitation, tracked as backlog): valuation metrics (P/E, P/B,
 * EV/EBITDA, ...) use the *current* market snapshot for every historical
 * period because the ingestion layer only pulls today's quote, not
 * period-end historical prices. Non-market metrics (profitability, growth,
 * financial strength, efficiency, earnings quality, moat) are period-accurate.
 * Fixing this requires a historical-price ingestion job keyed by statement
 * period-end date — see README "Known Limitations".
 */
export async function computeMetricsForCompany(ticker: string): Promise<void> {
  const symbol = ticker.toUpperCase();

  const [incomeSnap, balanceSnap, cashFlowSnap, companySnap] = await Promise.all([
    collections.incomeStatements(symbol).orderBy("fiscalYear", "desc").limit(MAX_PERIODS).get(),
    collections.balanceSheets(symbol).orderBy("fiscalYear", "desc").limit(MAX_PERIODS).get(),
    collections.cashFlowStatements(symbol).orderBy("fiscalYear", "desc").limit(MAX_PERIODS).get(),
    collections.company(symbol).get(),
  ]);

  const byYear = <T extends { fiscalYear: number }>(snap: FirebaseFirestore.QuerySnapshot): Map<number, T> =>
    new Map(snap.docs.map((d) => [((d.data() as T).fiscalYear), d.data() as T]));

  const incomeByYear = byYear<IncomeStatement>(incomeSnap);
  const balanceByYear = byYear<BalanceSheet>(balanceSnap);
  const cashFlowByYear = byYear<CashFlowStatement>(cashFlowSnap);

  const years = [...incomeByYear.keys()]
    .filter((y) => balanceByYear.has(y) && cashFlowByYear.has(y))
    .sort((a, b) => b - a)
    .slice(0, MAX_PERIODS);

  if (years.length === 0) return;

  const series: PeriodFinancials[] = years.map((y) => ({
    income: incomeByYear.get(y)!,
    balance: balanceByYear.get(y)!,
    cashFlow: cashFlowByYear.get(y)!,
  }));

  const latest = companySnap.data()?.latest as
    | { marketCap: number | null; enterpriseValue: number | null; sharePrice: number | null; sharesOutstanding: number | null }
    | undefined;
  const marketCap = latest?.marketCap ?? null;
  const sharesOutstanding = latest?.sharesOutstanding ?? null;
  const totalDebtLatest = series[0]?.balance.totalDebt ?? null;
  const cashLatest = series[0]?.balance.cashAndEquivalents ?? null;
  const enterpriseValue =
    latest?.enterpriseValue ??
    (marketCap !== null ? marketCap + (totalDebtLatest ?? 0) - (cashLatest ?? 0) : null);

  const writes: Array<Promise<unknown>> = [];

  // Only the most recent up to 5 periods get a full metric score written
  // (matching the product spec's "past 1-5 years of data per metric").
  const periodsToScore = Math.min(series.length, 5);
  for (let periodIndex = 0; periodIndex < periodsToScore; periodIndex++) {
    const periodKey = series[periodIndex].income.periodKey;
    const input: MetricInput = {
      ticker: symbol,
      periodKey,
      current: series[periodIndex],
      series: series.slice(periodIndex),
      marketCap,
      enterpriseValue,
      sharePrice: latest?.sharePrice ?? null,
      sharesOutstanding,
    };

    const scores: Record<string, MetricScore> = {};
    for (const def of METRIC_DEFINITIONS) {
      if (!def.enabled) continue;
      const calculator = METRIC_CALCULATORS[def.key];
      let rawValue: number | null = null;
      try {
        rawValue = calculator(input);
      } catch {
        rawValue = null;
      }
      scores[def.key] = {
        metricKey: def.key,
        periodKey,
        rawValue,
        isMissing: rawValue === null || Number.isNaN(rawValue) || !Number.isFinite(rawValue),
        percentile: null,
        zscore: null,
        rankAmongPeers: null,
        peerCount: 0,
        weight: 0,
        weightedScore: null,
      };
    }

    writes.push(
      collections.metricScores(symbol).doc(periodKey).set({ periodKey, scores, computedAt: new Date().toISOString() }),
    );
  }

  await Promise.all(writes);
}
