import type { MetricDefinition } from "@proverbs/shared";
import type { MetricCalculator } from "./types.js";
import * as valuation from "./calculators/valuation.js";
import * as profitability from "./calculators/profitability.js";
import * as cashGeneration from "./calculators/cashGeneration.js";
import { GROWTH_HORIZONS, GROWTH_LINE_ITEMS, growthCalculator } from "./calculators/growth.js";
import * as financialStrength from "./calculators/financialStrength.js";
import * as capitalAllocation from "./calculators/capitalAllocation.js";
import * as efficiency from "./calculators/efficiency.js";
import * as earningsQuality from "./calculators/earningsQuality.js";
import * as moat from "./calculators/moat.js";

interface MetricEntry {
  definition: MetricDefinition;
  calculator: MetricCalculator;
}

const entries: MetricEntry[] = [
  // --- Valuation ---
  { definition: { key: "ev_fcf", label: "EV / Free Cash Flow", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by free cash flow.", enabled: true }, calculator: valuation.evToFcf },
  { definition: { key: "ev_ebit", label: "EV / EBIT", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by EBIT.", enabled: true }, calculator: valuation.evToEbit },
  { definition: { key: "ev_ebitda", label: "EV / EBITDA", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by EBITDA.", enabled: true }, calculator: valuation.evToEbitda },
  { definition: { key: "pe_ttm", label: "P/E (TTM)", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by trailing net income.", enabled: true }, calculator: valuation.peTtm },
  { definition: { key: "pb", label: "P/B", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by book value of equity.", enabled: true }, calculator: valuation.priceToBook },
  { definition: { key: "ps", label: "P/S", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by revenue.", enabled: true }, calculator: valuation.priceToSales },
  { definition: { key: "price_tangible_book", label: "Price / Tangible Book", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by tangible book value.", enabled: true }, calculator: valuation.priceToTangibleBook },
  { definition: { key: "earnings_yield", label: "Earnings Yield", category: "valuation", direction: "desc", unit: "percent", description: "EBIT divided by enterprise value.", enabled: true }, calculator: valuation.earningsYield },
  { definition: { key: "fcf_yield", label: "FCF Yield", category: "valuation", direction: "desc", unit: "percent", description: "Free cash flow divided by market cap.", enabled: true }, calculator: valuation.fcfYield },
  { definition: { key: "shareholder_yield_valuation", label: "Shareholder Yield", category: "valuation", direction: "desc", unit: "percent", description: "Dividends + buybacks - issuance, divided by market cap.", enabled: true }, calculator: valuation.shareholderYield },

  // --- Profitability ---
  { definition: { key: "roic", label: "ROIC", category: "profitability", direction: "desc", unit: "percent", description: "Return on invested capital (NOPAT / invested capital).", enabled: true }, calculator: profitability.roic },
  { definition: { key: "roe", label: "ROE", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by shareholders' equity.", enabled: true }, calculator: profitability.roe },
  { definition: { key: "roa", label: "ROA", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by total assets.", enabled: true }, calculator: profitability.roa },
  { definition: { key: "gross_margin", label: "Gross Margin", category: "profitability", direction: "desc", unit: "percent", description: "Gross profit divided by revenue.", enabled: true }, calculator: profitability.grossMargin },
  { definition: { key: "operating_margin", label: "Operating Margin", category: "profitability", direction: "desc", unit: "percent", description: "Operating income divided by revenue.", enabled: true }, calculator: profitability.operatingMargin },
  { definition: { key: "net_margin", label: "Net Margin", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by revenue.", enabled: true }, calculator: profitability.netMargin },
  { definition: { key: "fcf_margin", label: "Free Cash Flow Margin", category: "profitability", direction: "desc", unit: "percent", description: "Free cash flow divided by revenue.", enabled: true }, calculator: profitability.freeCashFlowMargin },

  // --- Cash Generation ---
  { definition: { key: "ocf_margin", label: "Operating Cash Flow Margin", category: "cashGeneration", direction: "desc", unit: "percent", description: "Operating cash flow divided by revenue.", enabled: true }, calculator: cashGeneration.operatingCashFlowMargin },
  { definition: { key: "fcf_to_revenue", label: "FCF / Revenue", category: "cashGeneration", direction: "desc", unit: "percent", description: "Free cash flow divided by revenue.", enabled: true }, calculator: cashGeneration.fcfToRevenue },
  { definition: { key: "fcf_to_net_income", label: "FCF / Net Income", category: "cashGeneration", direction: "desc", unit: "ratio", description: "Free cash flow divided by net income.", enabled: true }, calculator: cashGeneration.fcfToNetIncome },
  { definition: { key: "cash_conversion_ratio", label: "Cash Conversion Ratio", category: "cashGeneration", direction: "desc", unit: "ratio", description: "Operating cash flow divided by net income.", enabled: true }, calculator: cashGeneration.cashConversionRatio },

  // --- Financial Strength ---
  { definition: { key: "cash_to_market_cap", label: "Cash / Market Cap", category: "financialStrength", direction: "desc", unit: "percent", description: "Cash and equivalents divided by market cap.", enabled: true }, calculator: financialStrength.cashToMarketCap },
  { definition: { key: "net_cash_to_market_cap", label: "Net Cash / Market Cap", category: "financialStrength", direction: "desc", unit: "percent", description: "(Cash - total debt) divided by market cap.", enabled: true }, calculator: financialStrength.netCashToMarketCap },
  { definition: { key: "debt_to_equity", label: "Debt / Equity", category: "financialStrength", direction: "asc", unit: "ratio", description: "Total debt divided by total equity.", enabled: true }, calculator: financialStrength.debtToEquity },
  { definition: { key: "current_ratio", label: "Current Ratio", category: "financialStrength", direction: "desc", unit: "ratio", description: "Current assets divided by current liabilities.", enabled: true }, calculator: financialStrength.currentRatio },
  { definition: { key: "quick_ratio", label: "Quick Ratio", category: "financialStrength", direction: "desc", unit: "ratio", description: "(Current assets - inventory) divided by current liabilities.", enabled: true }, calculator: financialStrength.quickRatio },
  { definition: { key: "interest_coverage", label: "Interest Coverage", category: "financialStrength", direction: "desc", unit: "ratio", description: "EBIT divided by interest expense.", enabled: true }, calculator: financialStrength.interestCoverage },
  { definition: { key: "debt_to_ebitda", label: "Debt / EBITDA", category: "financialStrength", direction: "asc", unit: "ratio", description: "Total debt divided by EBITDA.", enabled: true }, calculator: financialStrength.debtToEbitda },
  { definition: { key: "debt_maturity_mix", label: "Debt Maturity Mix", category: "financialStrength", direction: "desc", unit: "percent", description: "Share of total debt that is long-term (proxy for maturity/refinancing risk).", enabled: true }, calculator: financialStrength.debtMaturityMix },

  // --- Capital Allocation ---
  { definition: { key: "dividend_yield", label: "Dividend Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Dividends paid divided by market cap.", enabled: true }, calculator: capitalAllocation.dividendYield },
  { definition: { key: "dividend_cagr_3y", label: "Dividend CAGR (3Y)", category: "capitalAllocation", direction: "desc", unit: "percent", description: "3-year CAGR of dividends paid.", enabled: true }, calculator: capitalAllocation.dividendCagr },
  { definition: { key: "buyback_yield", label: "Buyback Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Stock buybacks divided by market cap.", enabled: true }, calculator: capitalAllocation.buybackYield },
  { definition: { key: "shareholder_yield_capalloc", label: "Shareholder Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Dividends + buybacks - issuance, divided by market cap.", enabled: true }, calculator: capitalAllocation.shareholderYieldCapAlloc },
  { definition: { key: "share_count_change", label: "Share Count Change (YoY)", category: "capitalAllocation", direction: "asc", unit: "percent", description: "Year-over-year change in diluted share count.", enabled: true }, calculator: capitalAllocation.shareCountChange },
  { definition: { key: "capex_to_revenue", label: "CapEx / Revenue", category: "capitalAllocation", direction: "asc", unit: "percent", description: "Capital expenditures divided by revenue.", enabled: true }, calculator: capitalAllocation.capexToRevenue },

  // --- Efficiency ---
  { definition: { key: "asset_turnover", label: "Asset Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Revenue divided by total assets.", enabled: true }, calculator: efficiency.assetTurnover },
  { definition: { key: "inventory_turnover", label: "Inventory Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Cost of revenue divided by inventory.", enabled: true }, calculator: efficiency.inventoryTurnover },
  { definition: { key: "receivable_turnover", label: "Receivable Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Revenue divided by receivables.", enabled: true }, calculator: efficiency.receivableTurnover },
  { definition: { key: "cash_conversion_cycle", label: "Cash Conversion Cycle", category: "efficiency", direction: "asc", unit: "years", description: "Days inventory + days sales - days payables outstanding.", enabled: true }, calculator: efficiency.cashConversionCycle },

  // --- Earnings Quality ---
  { definition: { key: "accrual_ratio", label: "Accrual Ratio", category: "earningsQuality", direction: "asc", unit: "ratio", description: "(Net income - operating cash flow) / total assets.", enabled: true }, calculator: earningsQuality.accrualRatio },
  { definition: { key: "fcf_exceeds_net_income", label: "FCF > Net Income", category: "earningsQuality", direction: "desc", unit: "ratio", description: "1 if free cash flow exceeds net income, else 0.", enabled: true }, calculator: earningsQuality.fcfExceedsNetIncome },
  { definition: { key: "gross_margin_stability", label: "Gross Margin Stability", category: "earningsQuality", direction: "desc", unit: "ratio", description: "Inverse of gross margin's coefficient of variation across history.", enabled: true }, calculator: earningsQuality.grossMarginStability },
  { definition: { key: "operating_margin_stability", label: "Operating Margin Stability", category: "earningsQuality", direction: "desc", unit: "ratio", description: "Inverse of operating margin's coefficient of variation across history.", enabled: true }, calculator: earningsQuality.operatingMarginStability },
  { definition: { key: "revenue_volatility", label: "Revenue Volatility", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Coefficient of variation of revenue across history.", enabled: true }, calculator: earningsQuality.revenueVolatility },
  { definition: { key: "eps_volatility", label: "EPS Volatility", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Coefficient of variation of diluted EPS across history.", enabled: true }, calculator: earningsQuality.epsVolatility },

  // --- Competitive Moat ---
  { definition: { key: "avg_roic_5y", label: "5-Year Average ROIC", category: "moat", direction: "desc", unit: "percent", description: "Average ROIC across up to 5 fiscal years.", enabled: true }, calculator: moat.avgRoic5y },
  { definition: { key: "avg_gross_margin_5y", label: "5-Year Average Gross Margin", category: "moat", direction: "desc", unit: "percent", description: "Average gross margin across up to 5 fiscal years.", enabled: true }, calculator: moat.avgGrossMargin5y },
  { definition: { key: "avg_operating_margin_5y", label: "5-Year Average Operating Margin", category: "moat", direction: "desc", unit: "percent", description: "Average operating margin across up to 5 fiscal years.", enabled: true }, calculator: moat.avgOperatingMargin5y },
  { definition: { key: "rnd_to_revenue", label: "R&D / Revenue", category: "moat", direction: "desc", unit: "percent", description: "Research & development expense divided by revenue.", enabled: true }, calculator: moat.rndToRevenue },
  { definition: { key: "intangible_assets_pct", label: "Intangible Assets %", category: "moat", direction: "desc", unit: "percent", description: "(Intangible assets + goodwill) divided by total assets.", enabled: true }, calculator: moat.intangibleAssetsPct },
];

// --- Growth: generated for {revenue, netIncome, eps, operatingCashFlow, freeCashFlow, bookValue} x {1, 3, 5} years ---
for (const { item, label } of GROWTH_LINE_ITEMS) {
  for (const years of GROWTH_HORIZONS) {
    entries.push({
      definition: {
        key: `growth_${item}_${years}y`,
        label: `${label} Growth (${years}Y CAGR)`,
        category: "growth",
        direction: "desc",
        unit: "percent",
        description: `${years}-year CAGR of ${label.toLowerCase()}.`,
        enabled: true,
      },
      calculator: growthCalculator(item, years),
    });
  }
}

export const METRIC_DEFINITIONS: MetricDefinition[] = entries.map((e) => e.definition);
export const METRIC_CALCULATORS: Record<string, MetricCalculator> = Object.fromEntries(
  entries.map((e) => [e.definition.key, e.calculator]),
);
