import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { FinancialDataProvider, type CompanyProfileResult, type ProviderCapabilities } from "./FinancialDataProvider.js";
import { sectorFromSicCode } from "./sicSectorMap.js";
import { resolveCountry } from "./usStateCodes.js";

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
  addresses?: {
    business?: { stateOrCountry?: string; stateOrCountryDescription?: string };
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
    const raw = units?.USD ?? units?.["USD/shares"] ?? units?.shares ?? [];
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

/** Latest annual (10-K) value per tag, most recent `periods` fiscal years. */
function annualSeries(facts: CompanyFacts | null, tags: string[], periods: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const fact of annualFactsByEnd(facts, tags)) {
    out.set(new Date(fact.end).getUTCFullYear(), fact.val);
  }
  // Trim to the most recent `periods` derived fiscal years — topYears() would do this anyway,
  // but callers other than topYears (e.g. size checks) expect this cap to already hold.
  return new Map([...out.entries()].sort((a, b) => b[0] - a[0]).slice(0, periods));
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
  /** Long-term debt only — that is what this dataset reliably carries (see extractBalanceSheets). */
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
  const facts = concept?.units?.USD ?? [];

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
 * dataset actually carries — costOfRevenue, ebitda, eps and shortTermDebt are
 * null for every filer here (see extractIncomeStatements/extractBalanceSheets),
 * so nothing downstream may depend on them.
 */
export function parseAnnualFundamentalsHistory(
  facts: CompanyFacts | null,
  years = FLOAT_HISTORY_MAX_YEARS,
): AnnualFundamentalsObservation[] {
  const revenueTags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
  const netIncome = annualSeries(facts, ["NetIncomeLoss"], years);
  const revenue = annualSeries(facts, revenueTags, years);
  const totalEquity = annualSeries(facts, ["StockholdersEquity"], years);
  const operatingIncome = annualSeries(facts, ["OperatingIncomeLoss"], years);
  const totalDebt = annualSeries(facts, ["LongTermDebtNoncurrent"], years);
  const cash = annualSeries(facts, ["CashAndCashEquivalentsAtCarryingValue"], years);
  const dilutedShares = annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], years);

  // Duration concepts first — their `end` IS the fiscal year end. Instant
  // (balance-sheet) concepts share that date, and only fill gaps for a year
  // where no income-statement tag was reported at all.
  const periodEnds = annualPeriodEnds(facts, [...revenueTags, "NetIncomeLoss", "OperatingIncomeLoss"]);
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
    return this.tickerToCik.get(ticker.toUpperCase()) ?? null;
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

  private extractIncomeStatements(facts: CompanyFacts | null, periods: number): IncomeStatement[] {
    const revenue = annualSeries(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], periods);
    const grossProfit = annualSeries(facts, ["GrossProfit"], periods);
    const rnd = annualSeries(facts, ["ResearchAndDevelopmentExpense"], periods);
    const opIncome = annualSeries(facts, ["OperatingIncomeLoss"], periods);
    const interestExpense = annualSeries(facts, ["InterestExpense"], periods);
    const pretax = annualSeries(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"], periods);
    const tax = annualSeries(facts, ["IncomeTaxExpenseBenefit"], periods);
    const netIncome = annualSeries(facts, ["NetIncomeLoss"], periods);
    const epsDiluted = annualSeries(facts, ["EarningsPerShareDiluted"], periods);
    const dilutedShares = annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], periods);

    const years = topYears(revenue.size ? revenue : netIncome, periods);
    return years.map((fy) => ({
      periodKey: `${fy}-FY`,
      periodType: "FY" as const,
      fiscalYear: fy,
      periodEnd: `${fy}-12-31`,
      filedAt: null,
      sourceProvider: this.name,
      revenue: revenue.get(fy) ?? null,
      costOfRevenue: null,
      grossProfit: grossProfit.get(fy) ?? null,
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
    }));
  }

  private extractBalanceSheets(facts: CompanyFacts | null, periods: number): BalanceSheet[] {
    const cash = annualSeries(facts, ["CashAndCashEquivalentsAtCarryingValue"], periods);
    const receivables = annualSeries(facts, ["AccountsReceivableNetCurrent"], periods);
    const inventory = annualSeries(facts, ["InventoryNet"], periods);
    const currentAssets = annualSeries(facts, ["AssetsCurrent"], periods);
    const totalAssets = annualSeries(facts, ["Assets"], periods);
    const intangibles = annualSeries(facts, ["IntangibleAssetsNetExcludingGoodwill"], periods);
    const goodwill = annualSeries(facts, ["Goodwill"], periods);
    const currentLiabilities = annualSeries(facts, ["LiabilitiesCurrent"], periods);
    const payables = annualSeries(facts, ["AccountsPayableCurrent"], periods);
    const longTermDebt = annualSeries(facts, ["LongTermDebtNoncurrent"], periods);
    const totalLiabilities = annualSeries(facts, ["Liabilities"], periods);
    const equity = annualSeries(facts, ["StockholdersEquity"], periods);
    const retainedEarnings = annualSeries(facts, ["RetainedEarningsAccumulatedDeficit"], periods);

    const years = topYears(totalAssets.size ? totalAssets : equity, periods);
    return years.map((fy) => {
      const eq = equity.get(fy) ?? null;
      const intang = intangibles.get(fy) ?? 0;
      const gw = goodwill.get(fy) ?? 0;
      return {
        periodKey: `${fy}-FY`,
        periodType: "FY" as const,
        fiscalYear: fy,
        periodEnd: `${fy}-12-31`,
        filedAt: null,
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
    const ocf = annualSeries(facts, ["NetCashProvidedByUsedInOperatingActivities"], periods);
    const capex = annualSeries(facts, ["PaymentsToAcquirePropertyPlantAndEquipment"], periods);
    const dividends = annualSeries(facts, ["PaymentsOfDividends"], periods);
    const buybacks = annualSeries(facts, ["PaymentsForRepurchaseOfCommonStock"], periods);
    const issuance = annualSeries(facts, ["ProceedsFromIssuanceOfCommonStock"], periods);

    const years = topYears(ocf, periods);
    return years.map((fy) => {
      const operatingCashFlow = ocf.get(fy) ?? null;
      const capexVal = capex.get(fy) ?? null;
      return {
        periodKey: `${fy}-FY`,
        periodType: "FY" as const,
        fiscalYear: fy,
        periodEnd: `${fy}-12-31`,
        filedAt: null,
        sourceProvider: this.name,
        operatingCashFlow,
        capitalExpenditures: capexVal !== null ? -Math.abs(capexVal) : null,
        freeCashFlow: operatingCashFlow !== null && capexVal !== null ? operatingCashFlow - Math.abs(capexVal) : null,
        dividendsPaid: dividends.get(fy) !== undefined ? -Math.abs(dividends.get(fy) as number) : null,
        stockBuybacks: buybacks.get(fy) !== undefined ? -Math.abs(buybacks.get(fy) as number) : null,
        stockIssuance: issuance.get(fy) ?? null,
        netDebtIssuance: null,
      };
    });
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
      (facts?.facts?.["us-gaap"]?.[tag]?.units?.USD ?? []).some((f) => f.form === "10-K"),
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
      const annual = (facts?.facts?.["us-gaap"]?.[tag]?.units?.USD ?? []).filter((f) => {
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
    const floatFacts = facts?.facts?.dei?.EntityPublicFloat?.units?.USD ?? [];
    const latestFloat = floatFacts.filter((f) => f.form === "10-K").sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    if (!latestFloat) return null;

    const sharesFacts = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
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

    return {
      ticker: ticker.toUpperCase(),
      companyName: submission?.name ?? ticker.toUpperCase(),
      cik,
      sector: sectorFromSicCode(sicCode),
      industry: submission?.sicDescription ?? null,
      description: null,
      website: null,
      country,
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
    return this.extractIncomeStatements(cik ? await this.fetchCompanyFacts(cik) : null, periods);
  }

  async getBalanceSheets(ticker: string, periods: number): Promise<BalanceSheet[]> {
    const cik = await this.cikFor(ticker);
    return this.extractBalanceSheets(cik ? await this.fetchCompanyFacts(cik) : null, periods);
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

    return {
      ticker: ticker.toUpperCase(),
      cik,
      profile: this.buildProfile(ticker, cik, submission),
      income: this.extractIncomeStatements(facts, periods),
      balance: this.extractBalanceSheets(facts, periods),
      cashFlow: this.extractCashFlowStatements(facts, periods),
      approxMarketValue: this.extractApproxMarketValue(cik, facts),
    };
  }

  async listUniverse(): Promise<string[]> {
    await this.loadTickerMap();
    return [...this.tickerToCik.keys()];
  }
}
