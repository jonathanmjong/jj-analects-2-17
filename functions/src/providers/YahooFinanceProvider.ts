import type { BalanceSheet, CashFlowStatement, IncomeStatement, MarketDataPoint } from "@proverbs/shared";
import { FinancialDataProvider, type CompanyProfileResult, type ProviderCapabilities } from "./FinancialDataProvider.js";

/**
 * Unofficial, keyless Yahoo Finance adapter (query1/query2.finance.yahoo.com).
 * These endpoints are not a documented/supported public API — they can change
 * or start requiring a session crumb without notice. Kept intentionally
 * dependency-free (fetch only) so it's easy to swap for FmpProvider or
 * PolygonProvider once paid keys are available; see providers/index.ts.
 */
export class YahooFinanceProvider extends FinancialDataProvider {
  readonly name = "yahoo_finance";
  readonly capabilities: ProviderCapabilities = {
    quotes: true,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: true,
    requiresApiKey: false,
  };

  private readonly baseUrl = "https://query2.finance.yahoo.com";
  private readonly userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

  private async fetchQuoteSummary(ticker: string, modules: string[]): Promise<Record<string, unknown> | null> {
    const url = `${this.baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules.join(",")}`;
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      quoteSummary?: { result?: Array<Record<string, unknown>>; error?: unknown };
    };
    const result = json.quoteSummary?.result?.[0];
    return result ?? null;
  }

  /**
   * quoteSummary (used above for statement history) is aggressively
   * rate-limited in practice ("Too Many Requests" observed in production
   * even at low volume). The v8/finance/chart endpoint returns basic quote
   * fields (price, day range, 52-week range, company name) and has held up
   * reliably, so it's the sole source for getQuote().
   */
  private async fetchChartQuote(ticker: string): Promise<Record<string, unknown> | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, unknown> }>; error?: unknown };
    };
    return json.chart?.result?.[0]?.meta ?? null;
  }

  private raw(node: unknown): number | null {
    if (node && typeof node === "object" && "raw" in (node as Record<string, unknown>)) {
      const value = (node as Record<string, unknown>).raw;
      return typeof value === "number" ? value : null;
    }
    return null;
  }

  async getQuote(ticker: string): Promise<MarketDataPoint | null> {
    const meta = await this.fetchChartQuote(ticker);
    const sharePrice = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
    if (sharePrice === null) return null;
    return {
      date: new Date().toISOString().slice(0, 10),
      sharePrice,
      // Yahoo's chart endpoint doesn't include market cap / shares outstanding;
      // ingestPrices.ts fills these in from the most recently ingested
      // statement's diluted share count.
      marketCap: 0,
      enterpriseValue: null,
      sharesOutstanding: null,
    };
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfileResult | null> {
    const summary = await this.fetchQuoteSummary(ticker, ["assetProfile", "price", "quoteType"]);
    const profile = summary?.assetProfile as Record<string, unknown> | undefined;
    const price = summary?.price as Record<string, unknown> | undefined;
    const quoteType = summary?.quoteType as Record<string, unknown> | undefined;
    if (!profile && !price) return null;
    return {
      ticker: ticker.toUpperCase(),
      companyName: (price?.longName as string) ?? (quoteType?.longName as string) ?? ticker.toUpperCase(),
      cik: null,
      sector: (profile?.sector as string) ?? null,
      industry: (profile?.industry as string) ?? null,
      description: (profile?.longBusinessSummary as string) ?? null,
      website: (profile?.website as string) ?? null,
      country: (profile?.country as string) ?? null,
    };
  }

  private periodKeyFromEndDate(endDateRaw: number, type: "FY" | "Q"): string {
    const d = new Date(endDateRaw * 1000);
    const year = d.getUTCFullYear();
    if (type === "FY") return `${year}-FY`;
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `${year}-Q${quarter}`;
  }

  async getIncomeStatements(ticker: string, periods: number): Promise<IncomeStatement[]> {
    const summary = await this.fetchQuoteSummary(ticker, ["incomeStatementHistory"]);
    const rows =
      ((summary?.incomeStatementHistory as Record<string, unknown>)?.incomeStatementHistory as Array<
        Record<string, unknown>
      >) ?? [];
    return rows.slice(0, periods).map((row) => {
      const endDate = this.raw(row.endDate) ?? Date.now() / 1000;
      const periodKey = this.periodKeyFromEndDate(endDate, "FY");
      const revenue = this.raw(row.totalRevenue);
      const costOfRevenue = this.raw(row.costOfRevenue);
      const grossProfit = this.raw(row.grossProfit);
      const netIncome = this.raw(row.netIncome);
      const operatingIncome = this.raw(row.operatingIncome);
      const ebit = operatingIncome;
      const interestExpense = this.raw(row.interestExpense);
      const incomeTax = this.raw(row.incomeTaxExpense);
      return {
        periodKey,
        periodType: "FY",
        fiscalYear: Number(periodKey.slice(0, 4)),
        periodEnd: new Date(endDate * 1000).toISOString().slice(0, 10),
        filedAt: null,
        sourceProvider: this.name,
        revenue,
        costOfRevenue,
        grossProfit: grossProfit ?? (revenue !== null && costOfRevenue !== null ? revenue - costOfRevenue : null),
        researchAndDevelopment: this.raw(row.researchDevelopment),
        operatingIncome,
        ebit,
        ebitda: ebit !== null ? ebit : null,
        interestExpense,
        pretaxIncome: this.raw(row.incomeBeforeTax),
        incomeTaxExpense: incomeTax,
        netIncome,
        eps: null,
        epsDiluted: null,
        sharesOutstandingDiluted: null,
      } satisfies IncomeStatement;
    });
  }

  async getBalanceSheets(ticker: string, periods: number): Promise<BalanceSheet[]> {
    const summary = await this.fetchQuoteSummary(ticker, ["balanceSheetHistory"]);
    const rows =
      ((summary?.balanceSheetHistory as Record<string, unknown>)?.balanceSheetStatements as Array<
        Record<string, unknown>
      >) ?? [];
    return rows.slice(0, periods).map((row) => {
      const endDate = this.raw(row.endDate) ?? Date.now() / 1000;
      const periodKey = this.periodKeyFromEndDate(endDate, "FY");
      const totalAssets = this.raw(row.totalAssets);
      const totalLiabilities = this.raw(row.totalLiab);
      const totalEquity = this.raw(row.totalStockholderEquity);
      const intangibleAssets = this.raw(row.intangibleAssets);
      const goodwill = this.raw(row.goodWill);
      return {
        periodKey,
        periodType: "FY",
        fiscalYear: Number(periodKey.slice(0, 4)),
        periodEnd: new Date(endDate * 1000).toISOString().slice(0, 10),
        filedAt: null,
        sourceProvider: this.name,
        cashAndEquivalents: this.raw(row.cash),
        shortTermInvestments: this.raw(row.shortTermInvestments),
        receivables: this.raw(row.netReceivables),
        inventory: this.raw(row.inventory),
        totalCurrentAssets: this.raw(row.totalCurrentAssets),
        totalAssets,
        intangibleAssets,
        goodwill,
        totalCurrentLiabilities: this.raw(row.totalCurrentLiabilities),
        accountsPayable: this.raw(row.accountsPayable),
        shortTermDebt: this.raw(row.shortLongTermDebt),
        longTermDebt: this.raw(row.longTermDebt),
        totalDebt:
          (this.raw(row.shortLongTermDebt) ?? 0) + (this.raw(row.longTermDebt) ?? 0) || null,
        totalLiabilities,
        totalEquity,
        tangibleBookValue:
          totalEquity !== null ? totalEquity - (intangibleAssets ?? 0) - (goodwill ?? 0) : null,
        retainedEarnings: this.raw(row.retainedEarnings),
      } satisfies BalanceSheet;
    });
  }

  async getCashFlowStatements(ticker: string, periods: number): Promise<CashFlowStatement[]> {
    const summary = await this.fetchQuoteSummary(ticker, ["cashflowStatementHistory"]);
    const rows =
      ((summary?.cashflowStatementHistory as Record<string, unknown>)?.cashflowStatements as Array<
        Record<string, unknown>
      >) ?? [];
    return rows.slice(0, periods).map((row) => {
      const endDate = this.raw(row.endDate) ?? Date.now() / 1000;
      const periodKey = this.periodKeyFromEndDate(endDate, "FY");
      const operatingCashFlow = this.raw(row.totalCashFromOperatingActivities);
      const capex = this.raw(row.capitalExpenditures);
      return {
        periodKey,
        periodType: "FY",
        fiscalYear: Number(periodKey.slice(0, 4)),
        periodEnd: new Date(endDate * 1000).toISOString().slice(0, 10),
        filedAt: null,
        sourceProvider: this.name,
        operatingCashFlow,
        capitalExpenditures: capex,
        freeCashFlow: operatingCashFlow !== null && capex !== null ? operatingCashFlow + capex : null,
        dividendsPaid: this.raw(row.dividendsPaid),
        stockBuybacks: this.raw(row.repurchaseOfStock),
        stockIssuance: this.raw(row.issuanceOfStock),
        netDebtIssuance: null,
      } satisfies CashFlowStatement;
    });
  }
}
