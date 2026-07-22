import type { BalanceSheet, CashFlowStatement, Company, IncomeStatement, MarketDataPoint } from "@proverbs/shared";

export interface CompanyProfileResult {
  ticker: string;
  companyName: string;
  cik: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  country: string | null;
}

export interface ProviderCapabilities {
  quotes: boolean;
  companyProfile: boolean;
  incomeStatements: boolean;
  balanceSheets: boolean;
  cashFlowStatements: boolean;
  requiresApiKey: boolean;
}

/**
 * Every data source (Yahoo Finance, SEC EDGAR, FMP, Alpha Vantage, Finnhub,
 * Polygon, ...) implements this contract. Ingestion jobs and Cloud Functions
 * depend only on this abstraction, never on a concrete provider, so a new
 * source can be added by writing one adapter class and registering it in
 * providers/index.ts — no other code needs to change.
 */
export abstract class FinancialDataProvider {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract getQuote(ticker: string): Promise<MarketDataPoint | null>;

  abstract getCompanyProfile(ticker: string): Promise<CompanyProfileResult | null>;

  abstract getIncomeStatements(ticker: string, periods: number): Promise<IncomeStatement[]>;

  abstract getBalanceSheets(ticker: string, periods: number): Promise<BalanceSheet[]>;

  abstract getCashFlowStatements(ticker: string, periods: number): Promise<CashFlowStatement[]>;

  /** Optional: bulk-listable universe (e.g. S&P 500 constituents). Default: unsupported. */
  async listUniverse(): Promise<string[]> {
    return [];
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(
      `${providerName} is not configured. Supply an API key via functions config/secrets and ` +
        `finish the adapter in functions/src/providers/${providerName}Provider.ts before enabling it.`,
    );
    this.name = "ProviderNotConfiguredError";
  }
}

export function emptyCompanyRecord(ticker: string): Pick<Company, "ticker" | "companyName"> {
  return { ticker: ticker.toUpperCase(), companyName: ticker.toUpperCase() };
}
