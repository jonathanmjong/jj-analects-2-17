import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { log } from "../lib/logger.js";
import { FinancialDataProvider, type CompanyProfileResult, type ProviderCapabilities } from "./FinancialDataProvider.js";
import { sectorFromSicCode } from "./sicSectorMap.js";
import { formatHeadquarters, resolveCountry } from "./usStateCodes.js";

export interface XbrlFact {
  /** Present for "duration" concepts (income/cash-flow — value covers a period); absent for "instant" ones (balance-sheet — value as of a single date). */
  start?: string;
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
}

export interface CompanyFacts {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, XbrlFact[]> }>;
    dei?: Record<string, { units?: Record<string, XbrlFact[]> }>;
  };
}

interface SubmissionJson {
  name?: string;
  sic?: string;
  sicDescription?: string;
  /** MMDD, e.g. "0926". */
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  exchanges?: string[];
  /** Filing-status classification, e.g. "Large accelerated filer". */
  category?: string;
  addresses?: {
    business?: { city?: string; stateOrCountry?: string; stateOrCountryDescription?: string };
  };
}

export interface ApproxMarketValue {
  cik: string;
  /** Aggregate market value of common equity held by non-affiliates, as reported on the most recent 10-K cover page. */
  publicFloat: number;
  sharesOutstanding: number | null;
  /** Filing cover-page date the figures are "as of" — this is NOT a live/current price. */
  asOfDate: string;
  /** True if the filer reports actual Revenues/NetIncomeLoss — excludes ETFs, trusts, and other non-operating entities that still file EntityPublicFloat. */
  hasOperatingFinancials: boolean;
  /** Most recent annual Revenues figure, if reported — used for a market-cap-to-revenue plausibility check. */
  latestRevenue: number | null;
}

export interface SecCompanyBundle {
  ticker: string;
  cik: string;
  profile: CompanyProfileResult;
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  approxMarketValue: ApproxMarketValue | null;
}

/** EDGAR returns `{}` instead of `[]` for a present-but-empty unit series — see parsePublicFloatHistory. */
function asFactArray(value: unknown): XbrlFact[] {
  return Array.isArray(value) ? (value as XbrlFact[]) : [];
}

/**
 * The one annual (10-K) fact per fiscal period end, merged across `tags`.
 *
 * A single 10-K's XBRL data reports the primary current-year figure AND
 * every comparative period it discloses (prior fiscal years, and for
 * duration concepts sub-year quarterly breakdowns too) — all sharing the
 * SAME `fy`/`filed`/`form`, distinguished only by `start`/`end`. SEC's own
 * `fy` is therefore not a safe dedup/select key: taking "the first fact
 * for each fy" (the previous implementation) picked whichever comparative
 * period happened to appear first in the array for that fy. Confirmed in
 * production: AAPL's stored fy=2024 revenue was $394.3B — actually
 * FY2022's figure — while the real FY2024 figure ($391.0B) was discarded,
 * because the FY2022 comparative happened to appear before FY2024's own
 * figure in the same filing's fact array. This silently mislabels/corrupts
 * the "most recent years" every year-weighted score depends on.
 *
 * Fixed by deduping on `end` date instead (each fiscal period end is
 * genuinely unique) and merging across tags rather than stopping at the
 * first non-empty one — companies commonly switch which exact tag they
 * report a concept under mid-history (e.g. most filers moved from
 * `Revenues` to `RevenueFromContractWithCustomerExcludingAssessedTax`
 * around ASC 606 adoption circa 2018), so picking only the first tag with
 * any data silently truncates the series at that switchover. Duration
 * facts (has `start`) are also restricted to ~annual-length (350-380 day)
 * periods so quarterly comparatives aren't mistaken for annual ones;
 * instant facts (no `start`) need no such filter.
 */
function annualFactsByEnd(facts: CompanyFacts | null, tags: string[]): XbrlFact[] {
  if (!facts) return [];

  const byEnd = new Map<string, XbrlFact>();
  for (const tag of tags) {
    const units = facts.facts?.["us-gaap"]?.[tag]?.units;
    const raw = asFactArray(units?.USD ?? units?.["USD/shares"] ?? units?.shares);
    for (const fact of raw) {
      if (fact.form !== "10-K") continue;
      if (fact.start) {
        const days = (new Date(fact.end).getTime() - new Date(fact.start).getTime()) / 86_400_000;
        if (days < 350 || days > 380) continue;
      }
      const existing = byEnd.get(fact.end);
      if (!existing || fact.filed > existing.filed) byEnd.set(fact.end, fact);
    }
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function seriesByFiscalYear(annualFacts: XbrlFact[], periods: number): Map<number, number> {
  const out = new Map<number, number>();
  // Ascending by `end`, so for the rare filer with two annual period ends inside one
  // calendar year (fiscal-year-end change) the later period wins that year's slot.
  for (const fact of annualFacts) {
    out.set(new Date(fact.end).getUTCFullYear(), fact.val);
  }
  // Trim to the most recent `periods` derived fiscal years — topYears() would do this anyway,
  // but callers other than topYears (e.g. size checks) expect this cap to already hold.
  return new Map([...out.entries()].sort((a, b) => b[0] - a[0]).slice(0, periods));
}

/** Latest annual (10-K) value per tag, most recent `periods` fiscal years. */
function annualSeries(facts: CompanyFacts | null, tags: string[], periods: number): Map<number, number> {
  return seriesByFiscalYear(annualFactsByEnd(facts, tags), periods);
}

/**
 * STRICT per-period tag precedence — for concepts where different tags carry a
 * different ACCOUNTING BASIS and must never be blended.
 *
 * annualFactsByEnd merges its `tags` into one pool and resolves a per-period
 * collision by "later `filed` wins". That is right when the tags are synonyms
 * for the same figure (a filer migrating `Revenues` -> `RevenueFrom...`), but
 * wrong when they are not: within a single filing every tag shares one `filed`
 * date, so the winner would come down to array/tag iteration order. For net
 * income that would silently swap accounting bases on companies that are
 * already CORRECT — verified live on EDGAR, PLD/DUK/D/KIM/PSA/DLR all report
 * NetIncomeLoss, NetIncomeLossAvailableToCommonStockholdersBasic AND ProfitLoss
 * for the same period end at three different values.
 *
 * So: resolve each fiscal period end independently, taking the first tag in
 * `orderedTags` that has a qualifying fact for that period, and never let a
 * later tag displace an earlier one. Each tag is passed through
 * annualFactsByEnd ALONE, so all of its selection rules (10-K only, 350-380 day
 * duration, dedupe on `end`, later-`filed`-wins) still apply — but only ever
 * within a single tag, which is the only place they are safe.
 *
 * Returns the winning fact per period plus the tag that supplied it (ascending
 * by period end); the tag is carried for provenance/logging.
 */
function annualFactsByEndWithFallback(
  facts: CompanyFacts | null,
  orderedTags: string[],
): { fact: XbrlFact; tag: string }[] {
  const byEnd = new Map<string, { fact: XbrlFact; tag: string }>();
  for (const tag of orderedTags) {
    for (const fact of annualFactsByEnd(facts, [tag])) {
      if (!byEnd.has(fact.end)) byEnd.set(fact.end, { fact, tag });
    }
  }
  return [...byEnd.values()].sort((a, b) => a.fact.end.localeCompare(b.fact.end));
}

/** annualSeries, but resolving `orderedTags` by strict per-period precedence. */
function annualSeriesWithFallback(
  facts: CompanyFacts | null,
  orderedTags: string[],
  periods: number,
): Map<number, number> {
  return seriesByFiscalYear(
    annualFactsByEndWithFallback(facts, orderedTags).map((r) => r.fact),
    periods,
  );
}

/**
 * Net income, in strict per-period precedence order (see
 * annualFactsByEndWithFallback for why this must not be a plain tag merge).
 *
 * 1. `NetIncomeLoss` — net income attributable to the parent. What every
 *    currently-correct company in this dataset already resolves to; it must
 *    never be displaced by a fallback.
 * 2. `NetIncomeLossAvailableToCommonStockholdersBasic` — after preferred
 *    dividends, i.e. attributable to common. The better match for a
 *    market-cap-based multiple, since market cap prices common equity, so it
 *    ranks above the NCI-inclusive figure.
 * 3. `ProfitLoss` — INCLUDES noncontrolling interests, so it overstates the
 *    parent's share. Last resort: better than a null, but never preferred.
 *
 * Filers do drop off tag 1 mid-history rather than never using it: verified on
 * EDGAR, EXC's last `NetIncomeLoss` is FY2012, VTR's FY2009, ETR's FY2023 —
 * while SPG (CIK 0001063761) has none at all. Per-period resolution is what
 * keeps those old years on the parent-only basis while filling the recent ones,
 * instead of restating a company's whole history onto whichever basis happens
 * to cover the latest year.
 */
export const NET_INCOME_TAGS = [
  "NetIncomeLoss",
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "ProfitLoss",
];

/**
 * Gross profit. Only ever `GrossProfit` — there is no second us-gaap element for the subtotal, and
 * a filer that omits it has genuinely not published one (verified on EDGAR: MRK, LLY, UNH, PG, PFE
 * and MCD have no `GrossProfit` concept in any year). The list exists so the field is resolved
 * through the same strict-precedence path as everything else here, and so a future addition can't
 * be bolted on as a plain `annualSeries` merge.
 *
 * The real fallback for those filers is DERIVATION from revenue and cost of revenue — see
 * COST_OF_REVENUE_TAGS and extractIncomeStatements. That reaches MRK/LLY/UNH/PG/PFE but not
 * MCD/DIS/SO/NEE/SPG/PLD, which tag no cost-of-revenue concept either: restaurants, utilities and
 * REITs largely do not present a gross-profit line at all, so those stay null by nature, not by
 * omission.
 */
export const GROSS_PROFIT_TAGS = ["GrossProfit"];

/**
 * Cost of revenue, in strict per-period precedence order.
 *
 * Validated against live EDGAR rather than assumed: across ~60 filers, for every annual period where
 * the filer reports BOTH `GrossProfit` and revenue, the implied cost (revenue - gross profit) was
 * compared to each candidate tag.
 *   - `CostOfRevenue` matched 214/214 periods exactly. It is the total, always.
 *   - `CostOfGoodsAndServicesSold` matched 258/270; the 12 misses are filers whose own
 *     `GrossProfit` is a partial subtotal (DD, LHX report a NEGATIVE implied cost), not a tagging
 *     problem with this concept.
 *   - `CostOfGoodsSold` matched 8/82 and `CostOfServices` 6/82 — both are overwhelmingly ONE
 *     COMPONENT of a goods/services split, not the total (ADBE FY2017: `CostOfGoodsSold` is $57M
 *     against a real $1,010M cost of revenue; IBM FY2016: $6.6B against $41.4B). They are
 *     deliberately EXCLUDED: populating cost of revenue from a component would understate it and,
 *     worse, derive a wildly overstated gross profit. Summing the pair is not a fix either — where
 *     both are present their sum still missed the true total in 27 of 45 periods (IBM is short by
 *     ~2% every year; ADBE's pair covers 38% of its actual cost), because filers split into three
 *     or more lines and only tag two of them.
 *
 * `CostOfRevenue` ranks first on that perfect match rate. Order matters for the filers reporting
 * both: CAT tags `CostOfRevenue` $44.8B and `CostOfGoodsAndServicesSold` $49M (a rounding-error
 * sliver) for the same FY2025 period end, so the reverse order would report a ~99.9% gross margin.
 */
export const COST_OF_REVENUE_TAGS = ["CostOfRevenue", "CostOfGoodsAndServicesSold"];

/**
 * Total debt, in strict per-period precedence order, ordered by ACCOUNTING-BASIS PROXIMITY to
 * "long-term debt, excluding current maturities" — the basis this field has always carried.
 *
 * Verified live on EDGAR. Reading only `LongTermDebtNoncurrent` left ~half the universe null, and
 * a null here is not a null downstream: ingestPrices treats missing debt as ZERO, so enterprise
 * value was silently understated for every one of them.
 *
 * 1. `LongTermDebtNoncurrent` — the exact basis, and what every currently-correct company already
 *    resolves to. Must never be displaced.
 * 2. `LongTermDebtAndCapitalLeaseObligations` — the SAME noncurrent basis, additionally including
 *    finance-lease obligations. Measured against tag 1 across 31 filers, it was byte-identical in
 *    44 of 58 overlapping periods and within 0.3-5.8% on the rest (DUK 2009-2011, UPS 2011). It is
 *    the current tag for filers that have no tag 1 at all in recent years — XOM (FY2025 $34.2B),
 *    SO, CVX, VZ, BA, GE, HON, UNP, IBM, CVS, ABBV.
 * 3. `LongTermNotesPayable` — noncurrent, but notes only, so it can understate a filer with other
 *    long-term borrowings (MSFT FY2011: $10.75B vs $11.92B on tag 1). Still ranked above the
 *    including-current-maturities tags because it is on the right basis, and because ORCL — whose
 *    only usable series this is, 2009-2026 — tags a lone dimensionless `LongTermDebt` of ZERO at
 *    FY2022. Behind tag 4, Oracle's FY2022 debt would resolve to $0 instead of ~$122B.
 * 4. `LongTermDebt` — long-term debt INCLUDING current maturities. Broader than the field's stated
 *    basis (AAPL FY2025: $90.7B vs $78.3B noncurrent; 226 of 254 overlapping periods differ,
 *    systematically ~10-16% higher) but still debt-only, no short-term borrowings. Recovers
 *    BAC/WFC/C/MS/AXP/PNC/BLK/PLD/SPG/PSA/T/HD/AMT.
 * 5. `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` — tag 4's basis plus
 *    finance leases. Not in the original candidate set; added because it is the ONLY series
 *    JPM (FY2025 $435B), USB and MET have carried since ~2013.
 * 6. `DebtLongtermAndShorttermCombinedAmount` — LAST RESORT, and the one tag that changes what
 *    this field MEANS: it includes short-term borrowings, so for a filer resolved here `totalDebt`
 *    is total debt, not long-term debt (0 of 42 overlapping periods matched tag 1; LLY FY2014 was
 *    +50%). Kept because the alternative is worse — GS has had no other tag since 2018, and
 *    leaving it null makes its enterprise value understate debt by ~$356B rather than overstate it
 *    by its short-term borrowings. The caveat is documented on `BalanceSheet.totalDebt`.
 *
 * Not recoverable at all: Deere moved to a company-extension element after FY2021, and no us-gaap
 * tag carries its long-term borrowings.
 */
export const TOTAL_DEBT_TAGS = [
  "LongTermDebtNoncurrent",
  "LongTermDebtAndCapitalLeaseObligations",
  "LongTermNotesPayable",
  "LongTermDebt",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "DebtLongtermAndShorttermCombinedAmount",
];

/**
 * The subset of TOTAL_DEBT_TAGS that is NOT "long-term debt, excluding current maturities" — a
 * value resolved from one of these is a broader quantity than the field's nominal basis. Used only
 * to log which filers that applies to; nothing branches on it.
 */
const BROADER_THAN_LONG_TERM_DEBT_TAGS = new Set([
  "LongTermDebt",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "DebtLongtermAndShorttermCombinedAmount",
]);

/**
 * Distinct tags that supplied a value within the same most-recent-`periods` window
 * annualSeriesWithFallback returns, in precedence order. Provenance for logging only — a filer that
 * used a fallback only in years that got trimmed away is not interesting.
 */
function tagsUsed(facts: CompanyFacts | null, orderedTags: string[], periods: number): string[] {
  const resolved = annualFactsByEndWithFallback(facts, orderedTags);
  const kept = new Set(seriesByFiscalYear(resolved.map((r) => r.fact), periods).keys());
  const used = new Set(
    resolved.filter((r) => kept.has(new Date(r.fact.end).getUTCFullYear())).map((r) => r.tag),
  );
  return orderedTags.filter((tag) => used.has(tag));
}

/**
 * The real fiscal period end, from the same fact that supplied the row's own
 * values. This used to be fabricated as `${fy}-12-31`, which is simply wrong
 * for the 28% of this universe that does not close in December — Apple's FY2025
 * ended 2025-09-27 and was stored as 2025-12-31, an 95-day error. Falls back to
 * the synthetic date only when no contributing fact carries a usable end, so
 * the field stays non-null as its type promises.
 */
function resolvePeriodEnd(periodEnds: Map<number, string>, fy: number): string {
  return periodEnds.get(fy) ?? `${fy}-12-31`;
}

/**
 * The actual fiscal period end date behind each derived fiscal year, same
 * selection rules as annualSeries. Needed wherever a fiscal year label isn't
 * enough on its own — e.g. aligning a cover-page-dated figure to the fiscal
 * year it falls inside, which is off by one for filers whose year ends in
 * January–June.
 */
function annualPeriodEnds(facts: CompanyFacts | null, tags: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const fact of annualFactsByEnd(facts, tags)) {
    out.set(new Date(fact.end).getUTCFullYear(), fact.end);
  }
  return out;
}

/**
 * SEC `filed` values are plain ISO calendar dates. Anything else — absent, empty, or unparseable —
 * is treated as no date at all rather than coerced, because `filedAt` is the field a point-in-time
 * backtest would trust; a fabricated or today-defaulted date there is silently usable and wrong,
 * while a null is visibly unusable.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Also rejects a `filed` that precedes the fact's own period `end`, which is not a real filing —
 * nobody reports a period's numbers before the period closes — and is the one corruption that
 * would defeat the purpose of the field, since a filedAt earlier than the period end reads as
 * "knowable before it happened" and would license exactly the look-ahead a point-in-time gate
 * exists to prevent. Dropping it costs at most one contributor's date on a row whose other
 * concepts still carry sound ones.
 */
function usableFiledDate(fact: XbrlFact): string | null {
  const filed = fact.filed;
  if (typeof filed !== "string" || !ISO_DATE.test(filed) || Number.isNaN(Date.parse(filed))) return null;
  if (ISO_DATE.test(fact.end) && filed < fact.end) return null;
  return filed;
}

/**
 * The `filed` date of the fact that supplied each derived fiscal year's value — the filing-date
 * mirror of seriesByFiscalYear, deliberately assigning years the exact same way (ascending by
 * `end`, later period end wins the calendar-year slot) so a year's date always belongs to the very
 * fact whose number landed on the statement row. A winning fact with no usable `filed` clears the
 * year rather than leaving an earlier fact's date standing in for it.
 */
function filedDatesByFiscalYear(annualFacts: XbrlFact[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const fact of annualFacts) {
    const fy = new Date(fact.end).getUTCFullYear();
    const filed = usableFiledDate(fact);
    if (filed) out.set(fy, filed);
    else out.delete(fy);
  }
  return out;
}

/**
 * Filing date per derived fiscal year, same selection rules as annualSeries (it reuses
 * annualFactsByEnd, so 10-K only, 350-380 day durations, dedupe on `end` and later-`filed`-wins all
 * still apply). Not trimmed to `periods`: callers look years up by key, and the extra entries are
 * the ones topYears already discarded.
 */
export function annualFiledDates(facts: CompanyFacts | null, tags: string[]): Map<number, string> {
  return filedDatesByFiscalYear(annualFactsByEnd(facts, tags));
}

/** annualFiledDates for concepts resolved by strict per-period tag precedence (annualSeriesWithFallback). */
function annualFiledDatesWithFallback(facts: CompanyFacts | null, orderedTags: string[]): Map<number, string> {
  return filedDatesByFiscalYear(annualFactsByEndWithFallback(facts, orderedTags).map((r) => r.fact));
}

/**
 * The statement row's `filedAt`: the LATEST filing date across every concept that contributed a
 * value to that fiscal year. See StatementPeriodMeta.filedAt for why the maximum is the only
 * defensible choice — the row carries restated values, so it was not knowable at the date of the
 * earliest filing behind it. ISO dates compare lexicographically, so a string max is a date max.
 */
function latestFiledByFiscalYear(sources: Map<number, string>[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const source of sources) {
    for (const [fy, filed] of source) {
      const existing = out.get(fy);
      if (!existing || filed > existing) out.set(fy, filed);
    }
  }
  return out;
}

function topYears(series: Map<number, number>, periods: number): number[] {
  return [...series.keys()].sort((a, b) => b - a).slice(0, periods);
}

/**
 * One year of the company's own valuation history: the public float from
 * that fiscal year's 10-K cover page, joined to that year's fundamentals.
 *
 * METHODOLOGY — `dei:EntityPublicFloat` is PUBLIC FLOAT, not market cap: it
 * excludes insider/affiliate-held shares, and it is measured as of the last
 * business day of the company's most recently completed second fiscal
 * quarter (the 10-K cover-page date), NOT at fiscal year end. Multiples
 * built from it are therefore only valid for comparing a company to ITSELF
 * across years, where the basis is consistent — never against market-cap
 * based multiples (this app's `latest.marketCap`, sector percentiles) without
 * an explicit normalization. `asOf` is carried through for exactly that
 * reason: the consumer must be able to see what date the numerator is from.
 */
export interface PublicFloatObservation {
  /** SEC's own fiscal-year focus for the filing this cover-page figure came from. */
  fiscalYear: number;
  /** Cover-page measurement date — typically ~6 months BEFORE the fiscal year end. */
  asOf: string;
  publicFloat: number;
}

export interface AnnualFundamentalsObservation {
  /** Calendar year of the fiscal period end — the same convention as `incomeStatements/{fiscalYear}`. */
  fiscalYear: number;
  periodEnd: string | null;
  netIncome: number | null;
  revenue: number | null;
  totalEquity: number | null;
  operatingIncome: number | null;
  /** Resolved through TOTAL_DEBT_TAGS — usually long-term debt only, see `BalanceSheet.totalDebt`. */
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  sharesOutstandingDiluted: number | null;
}

/** Response shape of https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomy}/{tag}.json */
export interface CompanyConceptJson {
  cik?: number;
  taxonomy?: string;
  tag?: string;
  units?: Record<string, XbrlFact[]>;
}

/** 10-K/A restates a prior 10-K's cover page, so amendments count too — unlike annualFactsByEnd, which only ever needs originals. */
function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A filer can be dual-listed; EDGAR returns an array and sometimes an empty string entry. */
export function normalizeExchanges(exchanges: string[] | null | undefined): string | null {
  if (!Array.isArray(exchanges)) return null;
  // Deduplicated case-insensitively: SEC lists one entry per REGISTERED SECURITY,
  // not per venue, so a filer with preferred series repeats the same exchange —
  // JPMorgan returned nine "NYSE" entries and rendered as "NYSE, NYSE, NYSE, ...".
  // First spelling wins so the filer's own casing is preserved.
  const seen = new Map<string, string>();
  for (const raw of exchanges) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return seen.size > 0 ? [...seen.values()].join(", ") : null;
}

/** Leap-year-permissive: Feb 29 is a legitimate fiscal year end for a filer whose FY ends then. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * EDGAR's fiscalYearEnd is MMDD ("0926"). Rejected rather than passed through when it isn't a real
 * calendar day, because the UI turns it into a month-and-day label and a malformed value would be
 * rendered as a confidently wrong date.
 */
export function normalizeFiscalYearEnd(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}$/.test(trimmed)) return null;
  const month = Number(trimmed.slice(0, 2));
  const day = Number(trimmed.slice(2));
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return trimmed;
}

const ANNUAL_FORMS = new Set(["10-K", "10-K/A"]);

const FLOAT_HISTORY_MAX_YEARS = 12;

/**
 * Pure parse of the dei/EntityPublicFloat companyconcept response into an
 * ascending per-fiscal-year float series.
 *
 * `isPlausible` is injected rather than imported: the one guard worth reusing
 * (`isPlausibleMarketCap`) lives in the ingestion layer, which already imports
 * this provider — importing it back here would make the module graph cyclic
 * and the provider's cold-start dependent on evaluation order. Filers get the
 * scale/decimals tagging on this specific field wrong often enough that the
 * caller should always pass it (see ingestPrices.ts for the production cases).
 */
export function parsePublicFloatHistory(
  concept: CompanyConceptJson | null,
  isPlausible: (publicFloat: number) => boolean = () => true,
  maxYears: number = FLOAT_HISTORY_MAX_YEARS,
): PublicFloatObservation[] {
  // EDGAR serves an empty *object* rather than an empty array for filers that
  // have the concept but no usable facts (observed on CTAS), so `?? []` is not
  // enough — that value isn't nullish and blows up the for-of.
  const facts = asFactArray(concept?.units?.USD);

  const byFiscalYear = new Map<number, XbrlFact>();
  for (const fact of facts) {
    if (!ANNUAL_FORMS.has(fact.form)) continue;
    if (!(fact.val > 0) || !isPlausible(fact.val)) continue;
    const fy = fact.fy ?? new Date(fact.end).getUTCFullYear();
    const existing = byFiscalYear.get(fy);
    // Latest cover-page date wins; a 10-K/A refiling the same date wins over the original.
    if (!existing || fact.end > existing.end || (fact.end === existing.end && fact.filed > existing.filed)) {
      byFiscalYear.set(fy, fact);
    }
  }

  return [...byFiscalYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-maxYears)
    .map(([fiscalYear, fact]) => ({ fiscalYear, asOf: fact.end, publicFloat: fact.val }));
}

/**
 * Pure parse of a companyfacts response into the per-fiscal-year line items
 * needed to form valuation multiples. Deliberately limited to fields this
 * dataset actually carries — ebitda, eps and shortTermDebt are null for every
 * filer here (see extractIncomeStatements/extractBalanceSheets), so nothing
 * downstream may depend on them.
 */
export function parseAnnualFundamentalsHistory(
  facts: CompanyFacts | null,
  years = FLOAT_HISTORY_MAX_YEARS,
): AnnualFundamentalsObservation[] {
  const revenueTags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
  const netIncome = annualSeriesWithFallback(facts, NET_INCOME_TAGS, years);
  const revenue = annualSeries(facts, revenueTags, years);
  const totalEquity = annualSeries(facts, ["StockholdersEquity"], years);
  const operatingIncome = annualSeries(facts, ["OperatingIncomeLoss"], years);
  const totalDebt = annualSeriesWithFallback(facts, TOTAL_DEBT_TAGS, years);
  const cash = annualSeries(facts, ["CashAndCashEquivalentsAtCarryingValue"], years);
  const dilutedShares = annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], years);

  // Duration concepts first — their `end` IS the fiscal year end. Instant
  // (balance-sheet) concepts share that date, and only fill gaps for a year
  // where no income-statement tag was reported at all.
  // All net income tags, not just NetIncomeLoss: a filer that reports only ProfitLoss would
  // otherwise have no period end at all for that year. Safe to plain-merge here because only the
  // `end` DATE is read — the values (and therefore the accounting-basis hazard) never enter.
  const periodEnds = annualPeriodEnds(facts, [...revenueTags, ...NET_INCOME_TAGS, "OperatingIncomeLoss"]);
  const instantEnds = annualPeriodEnds(facts, ["StockholdersEquity", "Assets"]);

  const allYears = new Set<number>([
    ...netIncome.keys(),
    ...revenue.keys(),
    ...totalEquity.keys(),
    ...operatingIncome.keys(),
    ...totalDebt.keys(),
    ...cash.keys(),
    ...dilutedShares.keys(),
  ]);

  return [...allYears]
    .sort((a, b) => a - b)
    .slice(-years)
    .map((fiscalYear) => ({
      fiscalYear,
      periodEnd: periodEnds.get(fiscalYear) ?? instantEnds.get(fiscalYear) ?? null,
      netIncome: netIncome.get(fiscalYear) ?? null,
      revenue: revenue.get(fiscalYear) ?? null,
      totalEquity: totalEquity.get(fiscalYear) ?? null,
      operatingIncome: operatingIncome.get(fiscalYear) ?? null,
      totalDebt: totalDebt.get(fiscalYear) ?? null,
      cashAndEquivalents: cash.get(fiscalYear) ?? null,
      sharesOutstandingDiluted: dilutedShares.get(fiscalYear) ?? null,
    }));
}

/**
 * Depreciation & amortization, in tag-precedence order.
 *
 * Filers genuinely split across these two tags with no way to predict which one a given company
 * uses: SPG (CIK 0001063761) reports only `DepreciationAndAmortization` (no
 * `DepreciationDepletionAndAmortization` concept at all), while Vornado (CIK 0000899689) reports
 * BOTH in the same filing, at slightly different values (FY2025: 481,456,000 vs 462,201,000).
 * Order therefore matters, and `DepreciationDepletionAndAmortization` is first because it is the
 * broader concept — it is the total charge as presented in the cash flow statement, whereas a
 * filer reporting both typically uses the narrower `DepreciationAndAmortization` for a component
 * of it. Taking the broader tag keeps the add-back consistent with what the cash flow statement
 * actually reconciles.
 *
 * annualFactsByEnd merges across tags and dedups per period end on `filed` date, so within a
 * single filing (one `filed` date for every tag) this array's order decides the winner; a later
 * restatement of either tag still wins over an earlier filing, which is the intended behavior
 * everywhere else in this file.
 */
export const DEPRECIATION_AND_AMORTIZATION_TAGS = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"];

/**
 * Share-based compensation, in STRICT per-period precedence order (annualSeriesWithFallback, not
 * the plain annualSeries merge D&A uses above) — because these two tags are NOT synonyms, and
 * within one filing every tag carries the same `filed` date, so a merge would let array order
 * decide which basis a company lands on. Exactly the failure mode documented on
 * annualFactsByEndWithFallback.
 *
 * 1. `ShareBasedCompensation` — the cash flow statement's OWN non-cash add-back line, i.e. the
 *    figure that actually reconciles net income to operating cash flow. Since both metrics built
 *    on this field measure SBC against revenue and against free cash flow, the number that
 *    inflates the cash flow being measured is the correct one to measure with.
 * 2. `AllocatedShareBasedCompensationExpense` — the compensation NOTE's total allocated across
 *    expense lines. Related, but a different figure: it can include amounts capitalized rather
 *    than expensed through the cash flow add-back, and filers often present it rounded.
 *
 * Verified live on EDGAR (2026-08). Where a filer reports both, they frequently agree exactly
 * (AAPL: identical in all 14 overlapping periods; IBM's last three years byte-identical), but
 * they materially disagree often enough that the order matters: across a 10-filer sample, 31 of
 * 115 overlapping periods differed and 20 differed by more than 2% — GOOGL FY2025 is
 * `ShareBasedCompensation` $24.953B against `AllocatedShareBasedCompensationExpense` $27.1B
 * (+8.6%), JNJ FY2023 $1.138B against $1.028B (-9.7%), IBM FY2020 $937M against $873M (-6.8%),
 * and Realty Income's note figure is simply the cash flow figure rounded to $0.1M ($4.700M vs
 * $4.726M for FY2009). All of those pairs share one `filed` date, so nothing but this list's
 * order separates them.
 *
 * The fallback earns its place rather than merely padding: MSFT tags `ShareBasedCompensation`
 * for 12 annual periods but `AllocatedShareBasedCompensationExpense` for 19, and WMT tags ONLY
 * the fallback (16 periods, zero under the primary) — without it Walmart would have no SBC at
 * all. JPM is the mirror image (19 periods under the primary, none under the fallback), and XOM
 * has neither, which stays null by design.
 */
export const SHARE_BASED_COMPENSATION_TAGS = ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"];

/**
 * Pure parse of a companyfacts response into annual cash flow statements. Exported (rather than
 * living only as a private method) so the tag-merge behavior above is testable without HTTP —
 * same convention as parsePublicFloatHistory / parseAnnualFundamentalsHistory.
 */
export function parseAnnualCashFlowStatements(
  facts: CompanyFacts | null,
  periods: number,
  sourceProvider: string,
): CashFlowStatement[] {
  const ocfTags = ["NetCashProvidedByUsedInOperatingActivities"];
  const capexTags = ["PaymentsToAcquirePropertyPlantAndEquipment"];
  const dividendTags = ["PaymentsOfDividends"];
  const buybackTags = ["PaymentsForRepurchaseOfCommonStock"];
  const issuanceTags = ["ProceedsFromIssuanceOfCommonStock"];

  const ocf = annualSeries(facts, ocfTags, periods);
  const capex = annualSeries(facts, capexTags, periods);
  const dividends = annualSeries(facts, dividendTags, periods);
  const buybacks = annualSeries(facts, buybackTags, periods);
  const issuance = annualSeries(facts, issuanceTags, periods);
  const depreciation = annualSeries(facts, DEPRECIATION_AND_AMORTIZATION_TAGS, periods);
  const shareBasedComp = annualSeriesWithFallback(facts, SHARE_BASED_COMPENSATION_TAGS, periods);

  const filedAt = latestFiledByFiscalYear([
    annualFiledDates(facts, ocfTags),
    annualFiledDates(facts, capexTags),
    annualFiledDates(facts, dividendTags),
    annualFiledDates(facts, buybackTags),
    annualFiledDates(facts, issuanceTags),
    annualFiledDates(facts, DEPRECIATION_AND_AMORTIZATION_TAGS),
    annualFiledDatesWithFallback(facts, SHARE_BASED_COMPENSATION_TAGS),
  ]);

  const cashFlowEnds = annualPeriodEnds(facts, ocfTags);
  const years = topYears(ocf, periods);
  return years.map((fy) => {
    const operatingCashFlow = ocf.get(fy) ?? null;
    const capexVal = capex.get(fy) ?? null;
    return {
      periodKey: `${fy}-FY`,
      periodType: "FY" as const,
      fiscalYear: fy,
      periodEnd: resolvePeriodEnd(cashFlowEnds, fy),
      filedAt: filedAt.get(fy) ?? null,
      sourceProvider,
      operatingCashFlow,
      capitalExpenditures: capexVal !== null ? -Math.abs(capexVal) : null,
      freeCashFlow: operatingCashFlow !== null && capexVal !== null ? operatingCashFlow - Math.abs(capexVal) : null,
      dividendsPaid: dividends.get(fy) !== undefined ? -Math.abs(dividends.get(fy) as number) : null,
      stockBuybacks: buybacks.get(fy) !== undefined ? -Math.abs(buybacks.get(fy) as number) : null,
      stockIssuance: issuance.get(fy) ?? null,
      netDebtIssuance: null,
      depreciationAndAmortization: depreciation.get(fy) ?? null,
      shareBasedCompensation: shareBasedComp.get(fy) ?? null,
    };
  });
}

/**
 * SEC EDGAR adapter — free, keyless, but rate-limited (SEC asks for <=10
 * req/sec and a descriptive User-Agent identifying the requester). Used as
 * the ground-truth fallback / cross-check source for XBRL financial
 * statement data since it comes directly from filed 10-Ks/10-Qs.
 *
 * getCompanyBundle() is the preferred entry point for bulk work (screening,
 * ingestion): it fetches companyfacts + submissions exactly once per
 * company and derives everything (statements, profile, approx market
 * value) from those two responses, instead of the 5 independent fetches
 * the per-capability methods below would otherwise cost.
 */
/**
 * Ticker -> CIK overrides for filers whose SEC `company_tickers.json` entry
 * points at an entity with no filing history.
 *
 * When a company reorganizes into a holding company, SEC repoints the ticker
 * to the NEW CIK immediately, but the operating company keeps filing the
 * 10-Ks and keeps the entire XBRL history. Verified for XOM on 2026-08-16:
 * the mapped CIK 2115436 ("ExxonMobil Holdings Corp") has filed no 10-K at
 * all and returns zero annual facts, while CIK 34088 ("Exxon Mobil Corp")
 * has 45 years of Revenues and filed a 10-K on 2026-02-18. Left alone, XOM
 * ingests as a company with no statements — no metrics, no rank, silently.
 *
 * Deliberately a short explicit list rather than a heuristic: guessing a
 * predecessor by name similarity risks attaching one company's fundamentals
 * to another, which is far worse than a missing company. `assertCikHasFilings`
 * exists to surface new cases so they can be added here on evidence.
 */
export const CIK_OVERRIDES: Record<string, string> = {
  XOM: "0000034088",
};

export class SecEdgarProvider extends FinancialDataProvider {
  readonly name = "sec_edgar";
  readonly capabilities: ProviderCapabilities = {
    quotes: false,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: true,
    requiresApiKey: false,
  };

  private readonly userAgent = "Analects217 research app (contact: jonathanmjong@gmail.com)";
  private tickerToCik = new Map<string, string>();
  private tickerMapLoaded = false;

  private async loadTickerMap(): Promise<void> {
    if (this.tickerMapLoaded) return;
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": this.userAgent },
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
      for (const entry of Object.values(json)) {
        this.tickerToCik.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, "0"));
      }
    }
    this.tickerMapLoaded = true;
  }

  private async cikFor(ticker: string): Promise<string | null> {
    await this.loadTickerMap();
    const symbol = ticker.toUpperCase();
    const override = CIK_OVERRIDES[symbol];
    if (override) {
      const mapped = this.tickerToCik.get(symbol);
      if (mapped && mapped !== override) {
        log.info(`cikFor(${symbol}): using operating-company CIK ${override} instead of SEC's mapped ${mapped}`);
      }
      return override;
    }
    return this.tickerToCik.get(symbol) ?? null;
  }

  private async fetchCompanyFacts(cik: string): Promise<CompanyFacts | null> {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!res.ok) return null;
    return (await res.json()) as CompanyFacts;
  }

  /**
   * A single XBRL concept's FULL filed history (companyfacts returns the same
   * facts, but this response is a few KB instead of several MB — worth the
   * separate request when only one tag is needed).
   */
  private async fetchCompanyConcept(cik: string, taxonomy: string, tag: string): Promise<CompanyConceptJson | null> {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!res.ok) return null;
    return (await res.json()) as CompanyConceptJson;
  }

  private async fetchSubmission(cik: string): Promise<SubmissionJson | null> {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmissionJson;
  }

  private extractIncomeStatements(facts: CompanyFacts | null, periods: number, ticker?: string): IncomeStatement[] {
    const revenueTags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
    const rndTags = ["ResearchAndDevelopmentExpense"];
    const opIncomeTags = ["OperatingIncomeLoss"];
    const interestExpenseTags = ["InterestExpense"];
    const pretaxTags = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"];
    const taxTags = ["IncomeTaxExpenseBenefit"];
    const epsDilutedTags = ["EarningsPerShareDiluted"];
    const dilutedSharesTags = ["WeightedAverageNumberOfDilutedSharesOutstanding"];

    const revenue = annualSeries(facts, revenueTags, periods);
    const grossProfit = annualSeriesWithFallback(facts, GROSS_PROFIT_TAGS, periods);
    const costOfRevenue = annualSeriesWithFallback(facts, COST_OF_REVENUE_TAGS, periods);
    const rnd = annualSeries(facts, rndTags, periods);
    const opIncome = annualSeries(facts, opIncomeTags, periods);
    const interestExpense = annualSeries(facts, interestExpenseTags, periods);
    const pretax = annualSeries(facts, pretaxTags, periods);
    const tax = annualSeries(facts, taxTags, periods);
    const netIncome = annualSeriesWithFallback(facts, NET_INCOME_TAGS, periods);
    const epsDiluted = annualSeries(facts, epsDilutedTags, periods);
    const dilutedShares = annualSeries(facts, dilutedSharesTags, periods);

    const filedAt = latestFiledByFiscalYear([
      annualFiledDates(facts, revenueTags),
      annualFiledDatesWithFallback(facts, GROSS_PROFIT_TAGS),
      annualFiledDatesWithFallback(facts, COST_OF_REVENUE_TAGS),
      annualFiledDates(facts, rndTags),
      annualFiledDates(facts, opIncomeTags),
      annualFiledDates(facts, interestExpenseTags),
      annualFiledDates(facts, pretaxTags),
      annualFiledDates(facts, taxTags),
      annualFiledDatesWithFallback(facts, NET_INCOME_TAGS),
      annualFiledDates(facts, epsDilutedTags),
      annualFiledDates(facts, dilutedSharesTags),
    ]);

    // Net income is the most load-bearing field in the dataset (P/E, every margin, growth CAGRs,
    // F-Score). Nothing records WHICH basis it came from — see the IncomeStatement shape — so at
    // least leave the provenance in the logs for the ~10% of filers that need a fallback.
    if (ticker) {
      const netIncomeTags = tagsUsed(facts, NET_INCOME_TAGS, periods);
      if (netIncomeTags.some((tag) => tag !== NET_INCOME_TAGS[0])) {
        log.info(`extractIncomeStatements(${ticker}): net income resolved from ${netIncomeTags.join(" + ")}`);
      }
    }

    const incomeEnds = annualPeriodEnds(facts, [...revenueTags, ...NET_INCOME_TAGS]);
    const years = topYears(revenue.size ? revenue : netIncome, periods);
    return years.map((fy) => {
      const revenueVal = revenue.get(fy) ?? null;
      const costOfRevenueVal = costOfRevenue.get(fy) ?? null;
      const reportedGrossProfit = grossProfit.get(fy) ?? null;
      return {
        periodKey: `${fy}-FY`,
        periodType: "FY" as const,
        fiscalYear: fy,
        periodEnd: resolvePeriodEnd(incomeEnds, fy),
        filedAt: filedAt.get(fy) ?? null,
        sourceProvider: this.name,
        revenue: revenueVal,
        costOfRevenue: costOfRevenueVal,
        // DERIVED, not reported, whenever the filer publishes no GrossProfit subtotal — the common
        // case (MRK, LLY, UNH, PG, PFE...) rather than the exotic one. A reported GrossProfit
        // always wins; derivation needs BOTH inputs, so a missing revenue or cost leaves this null
        // rather than silently reading as "zero cost of revenue".
        grossProfit:
          reportedGrossProfit ??
          (revenueVal !== null && costOfRevenueVal !== null ? revenueVal - costOfRevenueVal : null),
        researchAndDevelopment: rnd.get(fy) ?? null,
        operatingIncome: opIncome.get(fy) ?? null,
        ebit: opIncome.get(fy) ?? null,
        ebitda: null,
        interestExpense: interestExpense.get(fy) ?? null,
        pretaxIncome: pretax.get(fy) ?? null,
        incomeTaxExpense: tax.get(fy) ?? null,
        netIncome: netIncome.get(fy) ?? null,
        eps: null,
        epsDiluted: epsDiluted.get(fy) ?? null,
        sharesOutstandingDiluted: dilutedShares.get(fy) ?? null,
      };
    });
  }

  private extractBalanceSheets(facts: CompanyFacts | null, periods: number, ticker?: string): BalanceSheet[] {
    const cashTags = ["CashAndCashEquivalentsAtCarryingValue"];
    const receivableTags = ["AccountsReceivableNetCurrent"];
    const inventoryTags = ["InventoryNet"];
    const currentAssetTags = ["AssetsCurrent"];
    const totalAssetTags = ["Assets"];
    const intangibleTags = ["IntangibleAssetsNetExcludingGoodwill"];
    const goodwillTags = ["Goodwill"];
    const currentLiabilityTags = ["LiabilitiesCurrent"];
    const payableTags = ["AccountsPayableCurrent"];
    const totalLiabilityTags = ["Liabilities"];
    const equityTags = ["StockholdersEquity"];
    const retainedEarningsTags = ["RetainedEarningsAccumulatedDeficit"];

    const cash = annualSeries(facts, cashTags, periods);
    const receivables = annualSeries(facts, receivableTags, periods);
    const inventory = annualSeries(facts, inventoryTags, periods);
    const currentAssets = annualSeries(facts, currentAssetTags, periods);
    const totalAssets = annualSeries(facts, totalAssetTags, periods);
    const intangibles = annualSeries(facts, intangibleTags, periods);
    const goodwill = annualSeries(facts, goodwillTags, periods);
    const currentLiabilities = annualSeries(facts, currentLiabilityTags, periods);
    const payables = annualSeries(facts, payableTags, periods);
    const longTermDebt = annualSeriesWithFallback(facts, TOTAL_DEBT_TAGS, periods);
    const totalLiabilities = annualSeries(facts, totalLiabilityTags, periods);
    const equity = annualSeries(facts, equityTags, periods);
    const retainedEarnings = annualSeries(facts, retainedEarningsTags, periods);

    const filedAt = latestFiledByFiscalYear([
      annualFiledDates(facts, cashTags),
      annualFiledDates(facts, receivableTags),
      annualFiledDates(facts, inventoryTags),
      annualFiledDates(facts, currentAssetTags),
      annualFiledDates(facts, totalAssetTags),
      annualFiledDates(facts, intangibleTags),
      annualFiledDates(facts, goodwillTags),
      annualFiledDates(facts, currentLiabilityTags),
      annualFiledDates(facts, payableTags),
      annualFiledDatesWithFallback(facts, TOTAL_DEBT_TAGS),
      annualFiledDates(facts, totalLiabilityTags),
      annualFiledDates(facts, equityTags),
      annualFiledDates(facts, retainedEarningsTags),
    ]);

    // Nothing in the BalanceSheet shape records which tag a debt figure came from, and the lower
    // half of TOTAL_DEBT_TAGS is a broader quantity than "long-term debt" — leave the provenance
    // in the logs for the filers where that applies, as extractIncomeStatements does for net income.
    if (ticker) {
      const debtTags = tagsUsed(facts, TOTAL_DEBT_TAGS, periods).filter((tag) =>
        BROADER_THAN_LONG_TERM_DEBT_TAGS.has(tag),
      );
      if (debtTags.length > 0) {
        log.info(`extractBalanceSheets(${ticker}): total debt includes non-long-term basis from ${debtTags.join(" + ")}`);
      }
    }

    const balanceEnds = annualPeriodEnds(facts, ["Assets", "StockholdersEquity"]);
    const years = topYears(totalAssets.size ? totalAssets : equity, periods);
    return years.map((fy) => {
      const eq = equity.get(fy) ?? null;
      const intang = intangibles.get(fy) ?? 0;
      const gw = goodwill.get(fy) ?? 0;
      return {
        periodKey: `${fy}-FY`,
        periodType: "FY" as const,
        fiscalYear: fy,
        periodEnd: resolvePeriodEnd(balanceEnds, fy),
        filedAt: filedAt.get(fy) ?? null,
        sourceProvider: this.name,
        cashAndEquivalents: cash.get(fy) ?? null,
        shortTermInvestments: null,
        receivables: receivables.get(fy) ?? null,
        inventory: inventory.get(fy) ?? null,
        totalCurrentAssets: currentAssets.get(fy) ?? null,
        totalAssets: totalAssets.get(fy) ?? null,
        intangibleAssets: intangibles.get(fy) ?? null,
        goodwill: goodwill.get(fy) ?? null,
        totalCurrentLiabilities: currentLiabilities.get(fy) ?? null,
        accountsPayable: payables.get(fy) ?? null,
        shortTermDebt: null,
        longTermDebt: longTermDebt.get(fy) ?? null,
        totalDebt: longTermDebt.get(fy) ?? null,
        totalLiabilities: totalLiabilities.get(fy) ?? null,
        totalEquity: eq,
        tangibleBookValue: eq !== null ? eq - intang - gw : null,
        retainedEarnings: retainedEarnings.get(fy) ?? null,
      };
    });
  }

  private extractCashFlowStatements(facts: CompanyFacts | null, periods: number): CashFlowStatement[] {
    return parseAnnualCashFlowStatements(facts, periods, this.name);
  }

  /**
   * True for actual operating companies; false for ETFs/trusts/funds that
   * file EntityPublicFloat but don't report standard operating financials.
   * Deliberately checks only revenue tags, not NetIncomeLoss — investment
   * vehicles commonly report NetIncomeLoss too (their fund income), so it's
   * not a reliable signal on its own. Revenue-from-customers is: operating
   * companies almost universally report it, passive investment vehicles
   * almost never do (empirically confirmed against a crypto ETF that had
   * NetIncomeLoss but no Revenues tag at all).
   */
  private hasOperatingFinancials(facts: CompanyFacts | null): boolean {
    const tags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
    return tags.some((tag) =>
      asFactArray(facts?.facts?.["us-gaap"]?.[tag]?.units?.USD).some((f) => f.form === "10-K"),
    );
  }

  /**
   * Sorting by `filed` alone (the previous implementation) breaks: every
   * comparative period a 10-K discloses shares that filing's single `filed`
   * date, so a tie-break on `filed` silently falls back to array order and
   * can return a stale comparative instead of the true latest year (same
   * root cause as annualSeries' fix above). Restrict to annual-length
   * duration facts and pick by `end` date instead — genuinely unique.
   */
  private latestRevenue(facts: CompanyFacts | null): number | null {
    const tags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
    for (const tag of tags) {
      const annual = asFactArray(facts?.facts?.["us-gaap"]?.[tag]?.units?.USD).filter((f) => {
        if (f.form !== "10-K" || !f.start) return false;
        const days = (new Date(f.end).getTime() - new Date(f.start).getTime()) / 86_400_000;
        return days >= 350 && days <= 380;
      });
      const latest = [...annual].sort((a, b) => b.end.localeCompare(a.end))[0];
      if (latest) return latest.val;
    }
    return null;
  }

  private extractApproxMarketValue(cik: string, facts: CompanyFacts | null): ApproxMarketValue | null {
    const floatFacts = asFactArray(facts?.facts?.dei?.EntityPublicFloat?.units?.USD);
    const latestFloat = floatFacts.filter((f) => f.form === "10-K").sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    if (!latestFloat) return null;

    const sharesFacts = asFactArray(facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares);
    const latestShares = sharesFacts.filter((f) => f.form === "10-K").sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];

    return {
      cik,
      publicFloat: latestFloat.val,
      sharesOutstanding: latestShares?.val ?? null,
      asOfDate: latestFloat.end,
      hasOperatingFinancials: this.hasOperatingFinancials(facts),
      latestRevenue: this.latestRevenue(facts),
    };
  }

  private buildProfile(ticker: string, cik: string, submission: SubmissionJson | null): CompanyProfileResult {
    const sicCode = submission?.sic ? Number.parseInt(submission.sic, 10) : null;
    const address = submission?.addresses?.business;
    const country = resolveCountry(address?.stateOrCountry, address?.stateOrCountryDescription);

    // SEC's submissions record carries no business narrative and no website field, so these stay
    // null here — the profile a user reads is assembled from the identity fields below plus the
    // SIC description, never from an invented summary.
    return {
      ticker: ticker.toUpperCase(),
      companyName: submission?.name ?? ticker.toUpperCase(),
      cik,
      sector: sectorFromSicCode(sicCode),
      industry: submission?.sicDescription ?? null,
      description: null,
      website: null,
      country,
      exchange: normalizeExchanges(submission?.exchanges),
      stateOfIncorporation: nonEmpty(submission?.stateOfIncorporation),
      fiscalYearEnd: normalizeFiscalYearEnd(submission?.fiscalYearEnd),
      headquarters: formatHeadquarters(address?.city, address?.stateOrCountry, address?.stateOrCountryDescription),
      filerCategory: nonEmpty(submission?.category),
    };
  }

  async getQuote() {
    return null; // SEC EDGAR has no price data; pair with YahooFinanceProvider for quotes.
  }

  /**
   * Fallback used when the live price source is unavailable. `dei:EntityPublicFloat`
   * is required on every 10-K cover page — a real, official, keyless
   * approximation of market cap, just not a live one (it's as of the
   * filing's cover-page date, typically the end of the prior fiscal Q2).
   */
  async getApproxMarketValue(ticker: string): Promise<ApproxMarketValue | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) return null;
    return this.extractApproxMarketValue(cik, await this.fetchCompanyFacts(cik));
  }

  /**
   * Every 10-K cover page this filer has ever tagged, oldest first, capped at
   * the most recent 12 fiscal years — the free, keyless basis for comparing a
   * company's valuation to its OWN history. Read PublicFloatObservation's doc
   * comment before using these numbers: public float is not market cap, and
   * it is dated ~6 months before the fiscal year end it belongs to.
   *
   * `isPlausible` should be `isPlausibleMarketCap` from the ingestion layer —
   * see parsePublicFloatHistory for why it is a parameter and not an import.
   */
  async getPublicFloatHistory(
    ticker: string,
    isPlausible?: (publicFloat: number) => boolean,
  ): Promise<PublicFloatObservation[] | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) return null;
    const concept = await this.fetchCompanyConcept(cik, "dei", "EntityPublicFloat");
    if (!concept) return null;
    return parsePublicFloatHistory(concept, isPlausible);
  }

  /** The line items needed to form valuation multiples, per fiscal year, oldest first. */
  async getAnnualFundamentalsHistory(ticker: string, years = 12): Promise<AnnualFundamentalsObservation[] | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) return null;
    const facts = await this.fetchCompanyFacts(cik);
    if (!facts) return null;
    return parseAnnualFundamentalsHistory(facts, years);
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfileResult | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) return null;
    return this.buildProfile(ticker, cik, await this.fetchSubmission(cik));
  }

  async getIncomeStatements(ticker: string, periods: number): Promise<IncomeStatement[]> {
    const cik = await this.cikFor(ticker);
    return this.extractIncomeStatements(cik ? await this.fetchCompanyFacts(cik) : null, periods, ticker);
  }

  async getBalanceSheets(ticker: string, periods: number): Promise<BalanceSheet[]> {
    const cik = await this.cikFor(ticker);
    return this.extractBalanceSheets(cik ? await this.fetchCompanyFacts(cik) : null, periods, ticker);
  }

  async getCashFlowStatements(ticker: string, periods: number): Promise<CashFlowStatement[]> {
    const cik = await this.cikFor(ticker);
    return this.extractCashFlowStatements(cik ? await this.fetchCompanyFacts(cik) : null, periods);
  }

  /**
   * One companyfacts fetch + one submissions fetch (2 HTTP calls total,
   * down from 5) covering statements, profile, and approx market value.
   * Preferred entry point for bulk work — see class doc comment.
   */
  async getCompanyBundle(ticker: string, periods = 5): Promise<SecCompanyBundle | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) return null;
    const [facts, submission] = await Promise.all([this.fetchCompanyFacts(cik), this.fetchSubmission(cik)]);
    if (!facts) return null;

    const bundle = {
      ticker: ticker.toUpperCase(),
      cik,
      profile: this.buildProfile(ticker, cik, submission),
      income: this.extractIncomeStatements(facts, periods, ticker),
      balance: this.extractBalanceSheets(facts, periods, ticker),
      cashFlow: this.extractCashFlowStatements(facts, periods),
      approxMarketValue: this.extractApproxMarketValue(cik, facts),
    };

    // A live ticker whose CIK yields no annual statements at all is almost
    // always SEC having repointed it at a freshly-created holding company
    // while the operating company keeps filing (see CIK_OVERRIDES). Silently
    // ingesting an empty company is the failure mode that hid XOM, so say so.
    if (bundle.income.length === 0 && bundle.balance.length === 0) {
      log.warn(
        `getCompanyBundle(${bundle.ticker}): CIK ${cik} returned no annual statements — ` +
          `if this ticker reorganized, the filing history may live under a predecessor CIK (see CIK_OVERRIDES)`,
      );
    }
    return bundle;
  }

  async listUniverse(): Promise<string[]> {
    await this.loadTickerMap();
    return [...this.tickerToCik.keys()];
  }
}
