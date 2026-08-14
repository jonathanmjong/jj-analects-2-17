import { db, collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import {
  SecEdgarProvider,
  type AnnualFundamentalsObservation,
  type PublicFloatObservation,
} from "../providers/SecEdgarProvider.js";
import { isPlausibleMarketCap } from "./ingestPrices.js";

const secEdgar = new SecEdgarProvider();

/** Kept in step with the 12-year cap the provider applies to the float series. */
const MAX_YEARS = 12;

/**
 * How far a cover-page float date may sit before a fiscal year end and still
 * be treated as belonging to that year. The SEC requires the figure as of the
 * last business day of the most recently completed second fiscal quarter, so
 * the real gap is ~150-215 days; 300 leaves room for odd fiscal calendars and
 * filers who tag it at year end instead, while still refusing to reach into
 * the NEXT fiscal year when a company's own year is missing from the
 * fundamentals — a silent one-year mismatch (a valuation paired with the
 * wrong year's earnings) is worse than a dropped year.
 */
const MAX_FLOAT_TO_YEAR_END_DAYS = 300;

/**
 * One fiscal year of a company's own valuation history.
 *
 * `publicFloat` is `dei:EntityPublicFloat` — the aggregate market value of
 * common equity held by NON-AFFILIATES, as of the 10-K cover-page date
 * (`floatAsOf`, the end of the most recently completed second fiscal quarter).
 * It is NOT market cap (insider-held shares are excluded) and it is NOT
 * measured at fiscal year end. That is acceptable — and is the entire point
 * of this collection — for comparing a company to ITSELF across years, since
 * every year is measured on the same basis. It is NOT interchangeable with
 * the market-cap-based multiples the rest of the app computes from
 * `companies/{ticker}.latest`; anything that mixes the two needs an explicit
 * normalization first. `floatAsOf` is stored so the consumer can see, per
 * year, exactly what date the numerator came from.
 */
export interface ValuationHistoryDoc {
  fiscalYear: number;
  floatAsOf: string;
  publicFloat: number;
  netIncome: number | null;
  revenue: number | null;
  totalEquity: number | null;
  operatingIncome: number | null;
  /** Long-term debt only — the one debt figure this dataset reliably carries. */
  totalDebt: number | null;
  cash: number | null;
  sharesOutstanding: number | null;
  /**
   * publicFloat / market cap, which would let a consumer convert float-based
   * multiples onto a market-cap basis. Always null today: the only market cap
   * on hand is `latest.marketCap` (today's price), while publicFloat is dated
   * up to ~15 months earlier, so any ratio between them is insider ownership
   * and price drift mixed together — and when `latest.priceSource` is
   * "sec_public_float" it is derived from this very field, making the ratio
   * 1.0 by construction. Neither is defensible, so nothing is invented here.
   */
  impliedFloatRatio: number | null;
  /** Interpretation key for `publicFloat`/`floatAsOf` — see this interface's doc comment. */
  floatBasis: "dei_entity_public_float_cover_date";
  source: "sec_edgar";
}

const dayGap = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;

/**
 * Aligns a cover-page float to the fiscal year it falls INSIDE, by the actual
 * period end dates rather than by year labels. Labels alone are off by one for
 * filers whose fiscal year ends in January-June (a float measured in July 2024
 * belongs to a year ending January 2025, which this app labels 2025), which
 * would pair a valuation with the prior year's earnings.
 */
function fundamentalsForFloat(
  float: PublicFloatObservation,
  fundamentals: AnnualFundamentalsObservation[],
): AnnualFundamentalsObservation | undefined {
  const dated = fundamentals
    .filter((f) => f.periodEnd !== null)
    .sort((a, b) => (a.periodEnd as string).localeCompare(b.periodEnd as string));
  const matched = dated.find((f) => {
    const gap = dayGap(float.asOf, f.periodEnd as string);
    return gap >= 0 && gap <= MAX_FLOAT_TO_YEAR_END_DAYS;
  });
  if (matched) return matched;
  // Only for filers with no usable period end dates at all: fall back to SEC's
  // own fiscal-year focus, which agrees with the label convention for the
  // December-year-end majority.
  return dated.length === 0 ? fundamentals.find((f) => f.fiscalYear === float.fiscalYear) : undefined;
}

const hasUsableFundamental = (f: AnnualFundamentalsObservation) =>
  f.netIncome !== null || f.revenue !== null || f.totalEquity !== null || f.operatingIncome !== null;

/**
 * Pure join of the two EDGAR series into the documents written per fiscal
 * year. A year is emitted only when its float is present and plausible AND at
 * least one fundamental that can serve as a multiple's denominator exists —
 * missing line items stay null, never zero, since a zero-filled denominator
 * silently produces a real-looking multiple.
 */
export function buildValuationHistoryDocs(
  floats: PublicFloatObservation[],
  fundamentals: AnnualFundamentalsObservation[],
): ValuationHistoryDoc[] {
  const docs: ValuationHistoryDoc[] = [];

  for (const float of floats) {
    const f = fundamentalsForFloat(float, fundamentals);
    if (!f || !hasUsableFundamental(f)) continue;
    // Re-check the float against that year's own revenue: the absolute ceiling
    // alone misses filer scale errors that land inside it (see ingestPrices).
    if (!isPlausibleMarketCap(float.publicFloat, f.revenue)) continue;

    docs.push({
      fiscalYear: f.fiscalYear,
      floatAsOf: float.asOf,
      publicFloat: float.publicFloat,
      netIncome: f.netIncome,
      revenue: f.revenue,
      totalEquity: f.totalEquity,
      operatingIncome: f.operatingIncome,
      totalDebt: f.totalDebt,
      cash: f.cashAndEquivalents,
      sharesOutstanding: f.sharesOutstandingDiluted,
      impliedFloatRatio: null,
      floatBasis: "dei_entity_public_float_cover_date",
      source: "sec_edgar",
    });
  }

  // Two 10-K cover pages can align to one fiscal year (an original and a
  // restating 10-K/A tagged under different fiscal-year focuses); the later
  // cover date is the one already selected upstream, so keep the last write.
  const byYear = new Map(docs.map((d) => [d.fiscalYear, d]));
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear).slice(-MAX_YEARS);
}

/**
 * Writes `companies/{TICKER}/valuationHistory/{fiscalYear}` — the company's
 * own multi-year valuation basis (F3). Two EDGAR requests per company: the
 * dei/EntityPublicFloat concept (small) and companyfacts (large, but the only
 * source for the matching per-year fundamentals). This data only changes once
 * a year per company, when it files its next 10-K.
 */
export async function ingestValuationHistoryForTicker(
  ticker: string,
): Promise<{ ok: boolean; years?: number; error?: string }> {
  const symbol = ticker.toUpperCase();
  try {
    const [floats, fundamentals] = await Promise.all([
      secEdgar.getPublicFloatHistory(symbol, (publicFloat) => isPlausibleMarketCap(publicFloat)),
      secEdgar.getAnnualFundamentalsHistory(symbol, MAX_YEARS),
    ]);
    if (!floats || floats.length === 0) return { ok: false, error: "no EntityPublicFloat history on EDGAR" };
    if (!fundamentals || fundamentals.length === 0) return { ok: false, error: "no annual fundamentals on EDGAR" };

    const docs = buildValuationHistoryDocs(floats, fundamentals);
    if (docs.length === 0) return { ok: false, error: "no fiscal year had both a plausible float and fundamentals" };

    const batch = db.batch();
    const collection = collections.valuationHistory(symbol);
    const updatedAt = new Date().toISOString();
    for (const doc of docs) {
      batch.set(collection.doc(String(doc.fiscalYear)), { ...doc, updatedAt }, { merge: true });
    }
    await batch.commit();

    return { ok: true, years: docs.length };
  } catch (err) {
    log.error(`ingestValuationHistoryForTicker failed for ${symbol}`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Small concurrent waves with a stagger between them, matching what
 * expandUniverse does against the same endpoints — SEC asks for <=10 req/sec
 * and a descriptive User-Agent (the provider sends one on every request).
 */
const CONCURRENCY = 4;
const REQUEST_STAGGER_MS = 250;

export async function ingestValuationHistoryForUniverse(tickers: string[]) {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const wave = tickers.slice(i, i + CONCURRENCY);
    await Promise.all(
      wave.map(async (ticker) => {
        const result = await ingestValuationHistoryForTicker(ticker);
        if (result.ok) succeeded.push(ticker);
        else failed.push({ ticker, error: result.error ?? "unknown error" });
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, REQUEST_STAGGER_MS));
  }
  return { succeeded, failed };
}
