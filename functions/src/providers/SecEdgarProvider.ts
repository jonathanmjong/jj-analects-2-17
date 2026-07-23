import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { FinancialDataProvider, type CompanyProfileResult, type ProviderCapabilities } from "./FinancialDataProvider.js";
import { sectorFromSicCode } from "./sicSectorMap.js";

interface XbrlFact {
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
}

interface CompanyFacts {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, XbrlFact[]> }>;
    dei?: Record<string, { units?: Record<string, XbrlFact[]> }>;
  };
}

interface SubmissionJson {
  name?: string;
  sic?: string;
  sicDescription?: string;
  addresses?: { business?: { stateOrCountry?: string } };
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

  private async fetchSubmission(cik: string): Promise<SubmissionJson | null> {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmissionJson;
  }

  /** Latest annual (10-K) value per tag, most recent `periods` fiscal years, deduped by fiscal year. */
  private annualSeries(facts: CompanyFacts | null, tags: string[], periods: number): Map<number, number> {
    const out = new Map<number, number>();
    if (!facts) return out;
    for (const tag of tags) {
      const units = facts.facts?.["us-gaap"]?.[tag]?.units;
      const usd = units?.USD ?? units?.["USD/shares"] ?? [];
      for (const fact of usd) {
        if (fact.form !== "10-K") continue;
        if (out.has(fact.fy)) continue;
        out.set(fact.fy, fact.val);
      }
      if (out.size >= periods) break;
    }
    return out;
  }

  private topYears(series: Map<number, number>, periods: number): number[] {
    return [...series.keys()].sort((a, b) => b - a).slice(0, periods);
  }

  private extractIncomeStatements(facts: CompanyFacts | null, periods: number): IncomeStatement[] {
    const revenue = this.annualSeries(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], periods);
    const grossProfit = this.annualSeries(facts, ["GrossProfit"], periods);
    const rnd = this.annualSeries(facts, ["ResearchAndDevelopmentExpense"], periods);
    const opIncome = this.annualSeries(facts, ["OperatingIncomeLoss"], periods);
    const interestExpense = this.annualSeries(facts, ["InterestExpense"], periods);
    const pretax = this.annualSeries(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"], periods);
    const tax = this.annualSeries(facts, ["IncomeTaxExpenseBenefit"], periods);
    const netIncome = this.annualSeries(facts, ["NetIncomeLoss"], periods);
    const epsDiluted = this.annualSeries(facts, ["EarningsPerShareDiluted"], periods);
    const dilutedShares = this.annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], periods);

    const years = this.topYears(revenue.size ? revenue : netIncome, periods);
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
    const cash = this.annualSeries(facts, ["CashAndCashEquivalentsAtCarryingValue"], periods);
    const receivables = this.annualSeries(facts, ["AccountsReceivableNetCurrent"], periods);
    const inventory = this.annualSeries(facts, ["InventoryNet"], periods);
    const currentAssets = this.annualSeries(facts, ["AssetsCurrent"], periods);
    const totalAssets = this.annualSeries(facts, ["Assets"], periods);
    const intangibles = this.annualSeries(facts, ["IntangibleAssetsNetExcludingGoodwill"], periods);
    const goodwill = this.annualSeries(facts, ["Goodwill"], periods);
    const currentLiabilities = this.annualSeries(facts, ["LiabilitiesCurrent"], periods);
    const payables = this.annualSeries(facts, ["AccountsPayableCurrent"], periods);
    const longTermDebt = this.annualSeries(facts, ["LongTermDebtNoncurrent"], periods);
    const totalLiabilities = this.annualSeries(facts, ["Liabilities"], periods);
    const equity = this.annualSeries(facts, ["StockholdersEquity"], periods);
    const retainedEarnings = this.annualSeries(facts, ["RetainedEarningsAccumulatedDeficit"], periods);

    const years = this.topYears(totalAssets.size ? totalAssets : equity, periods);
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
    const ocf = this.annualSeries(facts, ["NetCashProvidedByUsedInOperatingActivities"], periods);
    const capex = this.annualSeries(facts, ["PaymentsToAcquirePropertyPlantAndEquipment"], periods);
    const dividends = this.annualSeries(facts, ["PaymentsOfDividends"], periods);
    const buybacks = this.annualSeries(facts, ["PaymentsForRepurchaseOfCommonStock"], periods);
    const issuance = this.annualSeries(facts, ["ProceedsFromIssuanceOfCommonStock"], periods);

    const years = this.topYears(ocf, periods);
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
    };
  }

  private buildProfile(ticker: string, cik: string, submission: SubmissionJson | null): CompanyProfileResult {
    const sicCode = submission?.sic ? Number.parseInt(submission.sic, 10) : null;
    return {
      ticker: ticker.toUpperCase(),
      companyName: submission?.name ?? ticker.toUpperCase(),
      cik,
      sector: sectorFromSicCode(sicCode),
      industry: submission?.sicDescription ?? null,
      description: null,
      website: null,
      country: submission?.addresses?.business?.stateOrCountry ?? null,
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
