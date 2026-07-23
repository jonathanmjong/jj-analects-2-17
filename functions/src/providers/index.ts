import { FinancialDataProvider } from "./FinancialDataProvider.js";
import { YahooFinanceProvider } from "./YahooFinanceProvider.js";
import { SecEdgarProvider } from "./SecEdgarProvider.js";
import { FmpProvider, AlphaVantageProvider, FinnhubProvider, PolygonProvider } from "./stubs.js";

export { FinancialDataProvider } from "./FinancialDataProvider.js";
export * from "./FinancialDataProvider.js";

export type ProviderKey =
  | "yahoo_finance"
  | "sec_edgar"
  | "financial_modeling_prep"
  | "alpha_vantage"
  | "finnhub"
  | "polygon";

/**
 * Central provider registry. Swapping which source backs ingestion is a
 * one-line change here (or an env var), never a change to ingestion logic —
 * that's the whole point of coding against FinancialDataProvider.
 */
const registry: Record<ProviderKey, () => FinancialDataProvider> = {
  yahoo_finance: () => new YahooFinanceProvider(),
  sec_edgar: () => new SecEdgarProvider(),
  financial_modeling_prep: () => new FmpProvider(),
  alpha_vantage: () => new AlphaVantageProvider(),
  finnhub: () => new FinnhubProvider(),
  polygon: () => new PolygonProvider(),
};

export function getProvider(key: ProviderKey): FinancialDataProvider {
  return registry[key]();
}

/**
 * Quotes/prices: Yahoo (SEC EDGAR has no price data).
 * Statement fundamentals + company profile: SEC EDGAR — ground truth from
 * filings, and far more reliable to call from Cloud Functions than Yahoo's
 * unofficial endpoints, which get blocked/rate-limited from cloud provider
 * IP ranges (observed empirically: company profile lookups silently
 * returned null in production even though local calls worked).
 */
export const PRICE_PROVIDER: ProviderKey = "yahoo_finance";
export const STATEMENT_PROVIDER: ProviderKey = "sec_edgar";
export const PROFILE_PROVIDER: ProviderKey = "sec_edgar";
