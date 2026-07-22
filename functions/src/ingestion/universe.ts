/**
 * Bootstrap ticker universe used before the first S&P 500 membership refresh
 * has run (see scheduled/sp500MembershipRefresh.ts, which scrapes the
 * Wikipedia constituents table and overwrites `isSp500`/`companies` docs).
 * Curated to span all eleven GICS-style sectors used across the app.
 */
export const SEED_UNIVERSE: string[] = [
  // Technology
  "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "ACN",
  // Communication Services
  "GOOGL", "META", "NFLX", "DIS", "CMCSA", "TMUS",
  // Consumer Discretionary
  "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG",
  // Consumer Staples
  "WMT", "PG", "KO", "PEP", "COST", "PM", "MDLZ",
  // Financials
  "BRK.B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SPGI", "BLK",
  // Healthcare
  "LLY", "UNH", "JNJ", "MRK", "ABBV", "PFE", "TMO", "ABT", "DHR", "AMGN",
  // Industrials
  "GE", "CAT", "UNP", "HON", "RTX", "BA", "UPS", "DE",
  // Energy
  "XOM", "CVX", "COP", "SLB", "EOG",
  // Utilities
  "NEE", "DUK", "SO", "AEP",
  // Real Estate
  "PLD", "AMT", "EQIX", "SPG",
  // Materials
  "LIN", "SHW", "FCX", "ECL",
];
