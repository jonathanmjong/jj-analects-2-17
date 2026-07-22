import type { BalanceSheet, CashFlowStatement, IncomeStatement, MarketDataPoint } from "@proverbs/shared";
import { FinancialDataProvider, ProviderNotConfiguredError, type CompanyProfileResult, type ProviderCapabilities } from "./FinancialDataProvider.js";

/**
 * Shared base for "not yet wired up" providers. Each concrete stub below
 * documents the exact env var / Firebase secret it needs and the base URL
 * of the real API. TODO once a key is supplied: replace the throw with a
 * fetch() implementation following the same shape as YahooFinanceProvider.
 */
abstract class UnconfiguredProvider extends FinancialDataProvider {
  protected abstract readonly envVar: string;

  private assertConfigured(): void {
    if (!process.env[this.envVar]) {
      throw new ProviderNotConfiguredError(this.name);
    }
  }

  async getQuote(_ticker: string): Promise<MarketDataPoint | null> {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(this.name);
  }
  async getCompanyProfile(_ticker: string): Promise<CompanyProfileResult | null> {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(this.name);
  }
  async getIncomeStatements(_ticker: string, _periods: number): Promise<IncomeStatement[]> {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(this.name);
  }
  async getBalanceSheets(_ticker: string, _periods: number): Promise<BalanceSheet[]> {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(this.name);
  }
  async getCashFlowStatements(_ticker: string, _periods: number): Promise<CashFlowStatement[]> {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(this.name);
  }
}

/** TODO: wire up at https://site.financialmodelingprep.com/developer/docs — set FMP_API_KEY. */
export class FmpProvider extends UnconfiguredProvider {
  readonly name = "financial_modeling_prep";
  protected readonly envVar = "FMP_API_KEY";
  readonly capabilities: ProviderCapabilities = {
    quotes: true,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: true,
    requiresApiKey: true,
  };
}

/** TODO: wire up at https://www.alphavantage.co/documentation/ — set ALPHA_VANTAGE_API_KEY. */
export class AlphaVantageProvider extends UnconfiguredProvider {
  readonly name = "alpha_vantage";
  protected readonly envVar = "ALPHA_VANTAGE_API_KEY";
  readonly capabilities: ProviderCapabilities = {
    quotes: true,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: true,
    requiresApiKey: true,
  };
}

/** TODO: wire up at https://finnhub.io/docs/api — set FINNHUB_API_KEY. */
export class FinnhubProvider extends UnconfiguredProvider {
  readonly name = "finnhub";
  protected readonly envVar = "FINNHUB_API_KEY";
  readonly capabilities: ProviderCapabilities = {
    quotes: true,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: false,
    requiresApiKey: true,
  };
}

/** TODO: wire up at https://polygon.io/docs — set POLYGON_API_KEY. */
export class PolygonProvider extends UnconfiguredProvider {
  readonly name = "polygon";
  protected readonly envVar = "POLYGON_API_KEY";
  readonly capabilities: ProviderCapabilities = {
    quotes: true,
    companyProfile: true,
    incomeStatements: true,
    balanceSheets: true,
    cashFlowStatements: true,
    requiresApiKey: true,
  };
}
