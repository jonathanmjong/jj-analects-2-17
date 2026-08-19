import type { MetricDefinition } from "@proverbs/shared";
import type { MetricCalculator } from "./types.js";
import * as valuation from "./calculators/valuation.js";
import * as momentum from "./calculators/momentum.js";
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
  { definition: { key: "ev_fcf", label: "EV / Free Cash Flow", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by free cash flow.", enabled: true, negativeIsBad: true }, calculator: valuation.evToFcf },
  { definition: { key: "ev_ebit", label: "EV / EBIT", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by EBIT.", enabled: true, negativeIsBad: true }, calculator: valuation.evToEbit },
  { definition: { key: "ev_ebitda", label: "EV / EBITDA", category: "valuation", direction: "asc", unit: "multiple", description: "Enterprise value divided by EBITDA.", enabled: true, negativeIsBad: true }, calculator: valuation.evToEbitda },
  { definition: { key: "pe_ttm", label: "P/E (TTM)", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by trailing net income.", enabled: true, negativeIsBad: true }, calculator: valuation.peTtm },
  { definition: { key: "pb", label: "P/B", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by book value of equity.", enabled: true, negativeIsBad: true }, calculator: valuation.priceToBook },
  { definition: { key: "ps", label: "P/S", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by revenue.", enabled: true, negativeIsBad: true }, calculator: valuation.priceToSales },
  { definition: { key: "price_tangible_book", label: "Price / Tangible Book", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by tangible book value.", enabled: true, negativeIsBad: true }, calculator: valuation.priceToTangibleBook },
  { definition: { key: "earnings_yield", label: "Earnings Yield", category: "valuation", direction: "desc", unit: "percent", description: "EBIT divided by enterprise value.", enabled: true }, calculator: valuation.earningsYield },
  { definition: { key: "fcf_yield", label: "FCF Yield", category: "valuation", direction: "desc", unit: "percent", description: "Free cash flow divided by market cap.", enabled: true }, calculator: valuation.fcfYield },
  { definition: { key: "shareholder_yield_valuation", label: "Shareholder Yield", category: "valuation", direction: "desc", unit: "percent", description: "Dividends + buybacks - issuance, divided by market cap.", enabled: true }, calculator: valuation.shareholderYield },
  // Real Estate only — see SECTOR_RESTRICTED_METRICS in shared/src/sectorApplicability.ts. Both
  // use an approximate FFO (net income + D&A); the description says so, since the NAREIT
  // definition's property-sale-gain and impairment adjustments aren't in this dataset.
  { definition: { key: "ffo_yield", label: "FFO Yield (approx.)", category: "valuation", direction: "desc", unit: "percent", description: "Approximate funds from operations divided by market cap. Approximate FFO: net income plus depreciation and amortization; excludes property-sale gains and impairments, which this data source does not carry.", enabled: true }, calculator: valuation.ffoYield },
  { definition: { key: "cape_ratio", label: "Price / 10y Avg Earnings", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by average annual net income over the longest available window up to 10 years (minimum 7). Prices the company against mid-cycle earnings instead of the last twelve months, so a cyclical at peak margins stops screening cheap. A nominal average, not inflation-adjusted: older years count in smaller dollars, which biases the average low and this multiple high.", enabled: true, negativeIsBad: true }, calculator: valuation.capeRatio },
  { definition: { key: "earnings_vs_normalized", label: "Latest vs Mid-Cycle Earnings", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Latest annual net income divided by its own average over the same multi-year window. Above 1 means earnings are currently running above trend, which is what makes a peak-cycle company look cheap on trailing multiples. Not computed in a loss year. Uses the same nominal, non-inflation-adjusted average as Price / 10y Avg Earnings.", enabled: true }, calculator: earningsQuality.earningsVsNormalized },
  { definition: { key: "price_to_ffo", label: "Price / FFO (approx.)", category: "valuation", direction: "asc", unit: "multiple", description: "Market cap divided by approximate funds from operations. Approximate FFO: net income plus depreciation and amortization; excludes property-sale gains and impairments, which this data source does not carry.", enabled: true, negativeIsBad: true }, calculator: valuation.priceToFfo },

  // --- Momentum ---
  { definition: { key: "momentum_12m1m", label: "12-1 Month Momentum", category: "momentum", direction: "desc", unit: "percent", description: "Trailing 12-month return excluding the most recent month (price 1 month ago vs. 12 months ago).", enabled: true }, calculator: momentum.return12m1m },
  { definition: { key: "momentum_risk_adj_3m", label: "3-Month Risk-Adjusted Momentum", category: "momentum", direction: "desc", unit: "ratio", description: "Trailing 3-month return divided by trailing 3-month daily-return volatility.", enabled: true }, calculator: momentum.riskAdjusted3m },
  { definition: { key: "momentum_risk_adj_6m", label: "6-Month Risk-Adjusted Momentum", category: "momentum", direction: "desc", unit: "ratio", description: "Trailing 6-month return divided by trailing 6-month daily-return volatility.", enabled: true }, calculator: momentum.riskAdjusted6m },

  // --- Profitability ---
  { definition: { key: "roic", label: "ROIC", category: "profitability", direction: "desc", unit: "percent", description: "Return on invested capital (NOPAT / invested capital).", enabled: true }, calculator: profitability.roic },
  { definition: { key: "roe", label: "ROE", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by shareholders' equity.", enabled: true }, calculator: profitability.roe },
  { definition: { key: "roa", label: "ROA", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by total assets.", enabled: true }, calculator: profitability.roa },
  { definition: { key: "gross_margin", label: "Gross Margin", category: "profitability", direction: "desc", unit: "percent", description: "Gross profit divided by revenue.", enabled: true }, calculator: profitability.grossMargin },
  { definition: { key: "operating_margin", label: "Operating Margin", category: "profitability", direction: "desc", unit: "percent", description: "Operating income divided by revenue.", enabled: true }, calculator: profitability.operatingMargin },
  { definition: { key: "net_margin", label: "Net Margin", category: "profitability", direction: "desc", unit: "percent", description: "Net income divided by revenue.", enabled: true }, calculator: profitability.netMargin },
  { definition: { key: "fcf_margin", label: "Free Cash Flow Margin", category: "profitability", direction: "desc", unit: "percent", description: "Free cash flow divided by revenue.", enabled: true }, calculator: profitability.freeCashFlowMargin },
  { definition: { key: "gross_profitability", label: "Gross Profitability", category: "profitability", direction: "desc", unit: "percent", description: "Gross profit divided by total assets (Novy-Marx, 2013). Measures profit before operating and financing costs per dollar of assets employed; levels differ structurally between asset-heavy and asset-light businesses, so it is most comparable within an industry. Not computed for Financials (see sectorApplicability.ts).", enabled: true }, calculator: profitability.grossProfitability },

  // --- Cash Generation ---
  { definition: { key: "ocf_margin", label: "Operating Cash Flow Margin", category: "cashGeneration", direction: "desc", unit: "percent", description: "Operating cash flow divided by revenue.", enabled: true }, calculator: cashGeneration.operatingCashFlowMargin },
  { definition: { key: "fcf_to_revenue", label: "FCF / Revenue", category: "cashGeneration", direction: "desc", unit: "percent", description: "Free cash flow divided by revenue.", enabled: true }, calculator: cashGeneration.fcfToRevenue },
  { definition: { key: "fcf_to_net_income", label: "FCF / Net Income", category: "cashGeneration", direction: "desc", unit: "ratio", description: "Free cash flow divided by net income.", enabled: true }, calculator: cashGeneration.fcfToNetIncome },
  { definition: { key: "cash_conversion_ratio", label: "Cash Conversion Ratio", category: "cashGeneration", direction: "desc", unit: "ratio", description: "Operating cash flow divided by net income.", enabled: true }, calculator: cashGeneration.cashConversionRatio },

  // --- Financial Strength ---
  { definition: { key: "cash_to_market_cap", label: "Cash / Market Cap", category: "financialStrength", direction: "desc", unit: "percent", description: "Cash and equivalents divided by market cap.", enabled: true }, calculator: financialStrength.cashToMarketCap },
  { definition: { key: "net_cash_to_market_cap", label: "Net Cash / Market Cap", category: "financialStrength", direction: "desc", unit: "percent", description: "(Cash - total debt) divided by market cap.", enabled: true }, calculator: financialStrength.netCashToMarketCap },
  { definition: { key: "debt_to_equity", label: "Debt / Equity", category: "financialStrength", direction: "asc", unit: "ratio", description: "Total debt divided by total equity.", enabled: true, negativeIsBad: true }, calculator: financialStrength.debtToEquity },
  { definition: { key: "current_ratio", label: "Current Ratio", category: "financialStrength", direction: "desc", unit: "ratio", description: "Current assets divided by current liabilities.", enabled: true }, calculator: financialStrength.currentRatio },
  { definition: { key: "quick_ratio", label: "Quick Ratio", category: "financialStrength", direction: "desc", unit: "ratio", description: "(Current assets - inventory) divided by current liabilities.", enabled: true }, calculator: financialStrength.quickRatio },
  { definition: { key: "interest_coverage", label: "Interest Coverage", category: "financialStrength", direction: "desc", unit: "ratio", description: "EBIT divided by interest expense.", enabled: true }, calculator: financialStrength.interestCoverage },
  { definition: { key: "debt_to_ebitda", label: "Debt / EBITDA", category: "financialStrength", direction: "asc", unit: "ratio", description: "Total debt divided by EBITDA.", enabled: true, negativeIsBad: true }, calculator: financialStrength.debtToEbitda },
  { definition: { key: "debt_maturity_mix", label: "Debt Maturity Mix", category: "financialStrength", direction: "desc", unit: "percent", description: "Share of total debt that is long-term (proxy for maturity/refinancing risk).", enabled: true }, calculator: financialStrength.debtMaturityMix },

  // --- Capital Allocation ---
  { definition: { key: "dividend_yield", label: "Dividend Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Dividends paid divided by market cap.", enabled: true }, calculator: capitalAllocation.dividendYield },
  { definition: { key: "dividend_cagr_3y", label: "Dividend CAGR (3Y)", category: "capitalAllocation", direction: "desc", unit: "percent", description: "3-year CAGR of dividends paid.", enabled: true }, calculator: capitalAllocation.dividendCagr },
  { definition: { key: "buyback_yield", label: "Buyback Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Stock buybacks divided by market cap.", enabled: true }, calculator: capitalAllocation.buybackYield },
  { definition: { key: "shareholder_yield_capalloc", label: "Shareholder Yield", category: "capitalAllocation", direction: "desc", unit: "percent", description: "Dividends + buybacks - issuance, divided by market cap.", enabled: true }, calculator: capitalAllocation.shareholderYieldCapAlloc },
  { definition: { key: "share_count_change", label: "Share Count Change (YoY)", category: "capitalAllocation", direction: "asc", unit: "percent", description: "Year-over-year change in diluted share count.", enabled: true }, calculator: capitalAllocation.shareCountChange },
  { definition: { key: "capex_to_revenue", label: "CapEx / Revenue", category: "capitalAllocation", direction: "asc", unit: "percent", description: "Capital expenditures divided by revenue.", enabled: true }, calculator: capitalAllocation.capexToRevenue },

  // --- Efficiency ---
  { definition: { key: "asset_turnover", label: "Asset Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Revenue divided by total assets.", enabled: true, sectorRelative: true }, calculator: efficiency.assetTurnover },
  { definition: { key: "inventory_turnover", label: "Inventory Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Cost of revenue divided by inventory.", enabled: true, sectorRelative: true }, calculator: efficiency.inventoryTurnover },
  { definition: { key: "receivable_turnover", label: "Receivable Turnover", category: "efficiency", direction: "desc", unit: "ratio", description: "Revenue divided by receivables.", enabled: true, sectorRelative: true }, calculator: efficiency.receivableTurnover },
  { definition: { key: "cash_conversion_cycle", label: "Cash Conversion Cycle", category: "efficiency", direction: "asc", unit: "years", description: "Days inventory + days sales - days payables outstanding.", enabled: true }, calculator: efficiency.cashConversionCycle },

  // --- Earnings Quality ---
  { definition: { key: "accrual_ratio", label: "Accrual Ratio", category: "earningsQuality", direction: "asc", unit: "ratio", description: "(Net income - operating cash flow) / total assets.", enabled: true }, calculator: earningsQuality.accrualRatio },
  { definition: { key: "fcf_exceeds_net_income", label: "FCF > Net Income", category: "earningsQuality", direction: "desc", unit: "ratio", description: "1 if free cash flow exceeds net income, else 0.", enabled: true }, calculator: earningsQuality.fcfExceedsNetIncome },
  { definition: { key: "gross_margin_stability", label: "Gross Margin Stability", category: "earningsQuality", direction: "desc", unit: "ratio", description: "Inverse of gross margin's coefficient of variation across history.", enabled: true }, calculator: earningsQuality.grossMarginStability },
  { definition: { key: "operating_margin_stability", label: "Operating Margin Stability", category: "earningsQuality", direction: "desc", unit: "ratio", description: "Inverse of operating margin's coefficient of variation across history.", enabled: true }, calculator: earningsQuality.operatingMarginStability },
  { definition: { key: "revenue_volatility", label: "Revenue Volatility", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Coefficient of variation of revenue across history.", enabled: true }, calculator: earningsQuality.revenueVolatility },
  { definition: { key: "eps_volatility", label: "EPS Volatility", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Coefficient of variation of diluted EPS across history.", enabled: true }, calculator: earningsQuality.epsVolatility },
  { definition: { key: "asset_growth", label: "Asset Growth (YoY)", category: "earningsQuality", direction: "asc", unit: "percent", description: "Year-over-year change in total assets (Cooper, Gulen & Schill, 2008). Ranked lower-is-better: across the published cross-sectional evidence, companies that expand their asset base fastest have tended to earn lower subsequent returns. It does not distinguish expansion that creates value from expansion that doesn't, and a fast-growing company will read poorly here while reading well on the growth category. Null without a prior fiscal year.", enabled: true }, calculator: earningsQuality.assetGrowth },
  { definition: { key: "net_operating_assets", label: "Net Operating Assets / Assets", category: "earningsQuality", direction: "asc", unit: "ratio", description: "Net operating assets divided by the prior year's total assets (Hirshleifer, Hou, Teoh & Zhang, 2004) — the share of the asset base built up from cumulative operating accruals rather than cash. Constructed here as (total equity + total debt - cash) / prior-year total assets, because operating and financing items are not reported separately in this data. Two limitations: total debt is long-term only in this dataset, so short-term borrowings are treated as operating liabilities and lower the ratio; minority interest and preferred stock are not carried and so are not removed. Ranked lower-is-better. Null without a prior fiscal year. Not computed for Financials (see sectorApplicability.ts).", enabled: true }, calculator: earningsQuality.netOperatingAssets },
  { definition: { key: "sbc_to_revenue", label: "SBC / Revenue", category: "earningsQuality", direction: "asc", unit: "percent", description: "Share-based compensation divided by revenue. SBC is a real, recurring cost of employing people that is settled in ownership rather than cash — it is what the dilution measured by Share Count Change actually costs, and it is the line most commonly excluded from the \"adjusted\" earnings companies headline. Ranked lower-is-better. Levels differ structurally by industry (software pays a far larger share of payroll in stock than retail does), so it is most comparable within an industry. Null when the filer tags no share-based compensation concept in that year, which some genuinely do not — that is a missing disclosure, not zero.", enabled: true }, calculator: earningsQuality.sbcToRevenue },
  { definition: { key: "sbc_to_fcf", label: "SBC / Free Cash Flow", category: "earningsQuality", direction: "asc", unit: "percent", description: "Share-based compensation divided by free cash flow. Free cash flow is overstated by exactly this amount: SBC is added back to operating cash flow as a non-cash charge, so the ratio says how much of the headline cash generation was funded by issuing stock instead of earning cash. Ranked lower-is-better. Not computed when free cash flow is zero or negative — the ratio would be negative or arbitrarily large rather than meaningful — so the companies it can least afford to miss, the cash-burning ones, are exactly the ones it cannot measure. Not computed for Financials (see sectorApplicability.ts).", enabled: true, negativeIsBad: true }, calculator: earningsQuality.sbcToFcf },
  { definition: { key: "piotroski_f_score", label: "Piotroski F-Score", category: "earningsQuality", direction: "desc", unit: "ratio", description: "9-point composite of year-over-year profitability, leverage/liquidity, and operating-efficiency improvement (Piotroski, 2000).", enabled: true }, calculator: earningsQuality.piotroskiFScore },

  // --- Competitive Moat ---
  { definition: { key: "avg_roic_5y", label: "5-Year Average ROIC", category: "moat", direction: "desc", unit: "percent", description: "Average ROIC across up to 5 fiscal years.", enabled: true }, calculator: moat.avgRoic5y },
  { definition: { key: "avg_gross_margin_5y", label: "5-Year Average Gross Margin", category: "moat", direction: "desc", unit: "percent", description: "Average gross margin across up to 5 fiscal years.", enabled: true }, calculator: moat.avgGrossMargin5y },
  { definition: { key: "avg_operating_margin_5y", label: "5-Year Average Operating Margin", category: "moat", direction: "desc", unit: "percent", description: "Average operating margin across up to 5 fiscal years.", enabled: true }, calculator: moat.avgOperatingMargin5y },
  { definition: { key: "rnd_to_revenue", label: "R&D / Revenue", category: "moat", direction: "asc", unit: "percent", description: "Research & development expense divided by revenue.", enabled: true }, calculator: moat.rndToRevenue },
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
