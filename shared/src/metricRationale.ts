import type { MetricCategory } from "./metrics.js";

/**
 * Value-investing commentary for the metric registry — admin-only explanatory content. Kept as
 * its own module rather than fields on MetricDefinition (metrics.ts) since MetricDefinition
 * flows into the ranking export every subscriber's browser fetches every session and should
 * stay lean; this content is only ever imported by the admin Value Metrics panel and by
 * functions/test's registry-alignment test (see metricRegistryValueInvesting.test.ts), which is
 * why it lives in shared/ rather than web/ despite being UI-only content.
 */

export type MetricVerdict = "core" | "supporting" | "caveat" | "not-value-investing";

export interface CategoryRationale {
  summary: string;
  verdict: MetricVerdict;
}

export const CATEGORY_RATIONALE: Record<MetricCategory, CategoryRationale> = {
  valuation: {
    summary:
      "The core of value investing: how much you're paying for a dollar of earnings, cash flow, or assets. Graham's \"margin of safety\" starts here — buying cheap, on its own, has a long academic and practical track record (Fama-French value factor, Greenblatt's Magic Formula).",
    verdict: "core",
  },
  momentum: {
    summary:
      "NOT a value-investing signal. Momentum measures recent price trend — buying what's already gone up — which is a distinct, often contradictory factor to buying undervalued, out-of-favor stocks. It's a real, academically documented anomaly (Jegadeesh & Titman), just not this app's philosophy: the default ranking weights this category at 0%.",
    verdict: "not-value-investing",
  },
  profitability: {
    summary:
      "Buffett's refinement of Graham: pay a fair price for a wonderful business, not just a statistically cheap one. High, sustainable returns on capital are what separate real compounders from value traps.",
    verdict: "core",
  },
  cashGeneration: {
    summary:
      'Graham and Buffett both prioritize cash over reported earnings — "earnings are an opinion, cash is a fact." These metrics check whether reported profit is actually backed by cash.',
    verdict: "core",
  },
  financialStrength: {
    summary:
      "Margin of safety isn't only about price — it's also about survival. A cheap stock that goes bankrupt is a total loss, not a bargain. These metrics check balance-sheet resilience.",
    verdict: "core",
  },
  capitalAllocation: {
    summary:
      "Buffett has written that capital allocation is management's single most important job. These metrics judge whether management is a good steward of shareholders' money — though several can't distinguish a smart decision from a poorly-timed one (see buyback metrics below).",
    verdict: "supporting",
  },
  efficiency: {
    summary:
      "How productively the business uses its assets — a lever on ROIC. Useful for comparing operational quality within an industry, but less central to classic value investing than valuation or quality, and mostly meaningful sector-relative rather than universe-wide.",
    verdict: "supporting",
  },
  earningsQuality: {
    summary:
      "A direct implementation of Graham's warning to scrutinize accounting, backed by modern academic work — Sloan's accrual anomaly shows companies with high accruals (earnings not backed by cash) systematically underperform afterward.",
    verdict: "core",
  },
  moat: {
    summary:
      "Buffett and Munger's thesis beyond Graham's \"cigar butt\" investing: pay for durable competitive advantages that let a company sustain high returns for a long time, not just for a cheap current price.",
    verdict: "core",
  },
  growth: {
    summary:
      "Value investing isn't allergic to growth — Buffett explicitly treats growth as part of intrinsic value, not a separate style. But growth alone, without profitability and valuation discipline, is exactly the \"growth at any price\" trap value investors avoid.",
    verdict: "supporting",
  },
};

export interface MetricRationaleEntry {
  rationale: string;
  verdict: MetricVerdict;
}

export const METRIC_RATIONALE: Record<string, MetricRationaleEntry> = {
  // --- Momentum (not value investing — see category summary above) ---
  momentum_12m1m: {
    verdict: "not-value-investing",
    rationale:
      "The classic academic momentum factor (Jegadeesh & Titman) — buys recent winners. A real, persistent anomaly, but the opposite instinct to value investing's \"buy what's out of favor.\" 0% default weight.",
  },
  momentum_risk_adj_3m: {
    verdict: "not-value-investing",
    rationale: "Same momentum logic as 12-1 month, adjusted for volatility over a much shorter window — noisier, and still not a value signal. 0% default weight.",
  },
  momentum_risk_adj_6m: {
    verdict: "not-value-investing",
    rationale: "Same as 3-month risk-adjusted momentum with a longer, somewhat less noisy lookback — still a trend-following factor, not a value one. 0% default weight.",
  },

  // --- Valuation ---
  ev_fcf: {
    verdict: "core",
    rationale:
      "One of the strongest single valuation multiples for cash-generative businesses: enterprise value accounts for debt (unlike price-based multiples), and free cash flow is harder to manipulate via accounting choices than net income.",
  },
  ev_ebit: {
    verdict: "core",
    rationale:
      "Half of Greenblatt's Magic Formula (paired with ROIC). EBIT strips out financing and tax differences, letting you compare companies with different capital structures fairly.",
  },
  ev_ebitda: {
    verdict: "caveat",
    rationale:
      "Widely used, but Munger and Buffett have both been openly skeptical — it ignores depreciation, treating a real, recurring cost (maintenance capex) as if it were discretionary. More reliable for cross-company comparability than as a standalone \"cheap or not\" verdict.",
  },
  pe_ttm: {
    verdict: "core",
    rationale:
      "The classic Graham metric — simple and well understood. Net income can be distorted by one-off items and accounting choices more easily than cash-flow-based multiples, so it's a good starting screen but rarely sufficient alone.",
  },
  pb: {
    verdict: "caveat",
    rationale:
      "Graham's original deep-value metric (buy below book value). Still reliable for asset-heavy businesses (banks, industrials), but much less meaningful for asset-light, IP-driven businesses (software, brands) where the real assets never show up on the balance sheet.",
  },
  ps: {
    verdict: "caveat",
    rationale:
      "Useful when earnings are temporarily depressed or negative (early-stage, cyclicals), but says nothing about profitability — a company can screen cheap on P/S while running structurally poor margins. Supporting signal only, never standalone.",
  },
  price_tangible_book: {
    verdict: "caveat",
    rationale:
      "A stricter P/B that strips out goodwill and intangibles from prior acquisitions — good for spotting genuinely asset-backed value, but carries the same asset-light blind spot as P/B.",
  },
  earnings_yield: {
    verdict: "core",
    rationale:
      "The inverse framing of EV/EBIT (Greenblatt's other Magic Formula leg) — higher is better, and it's directly comparable across companies with different capital structures.",
  },
  fcf_yield: {
    verdict: "core",
    rationale:
      "How much free cash a company generates relative to its price — a direct \"return\" investors are effectively buying. Free cash flow is harder to manipulate than reported earnings, making this one of the more trusted value signals.",
  },
  ffo_yield: {
    verdict: "supporting",
    rationale:
      "The yield framing of the multiple real-estate investors actually use. P/E is excluded for this sector because reported earnings are dominated by depreciation on properties that often appreciate; adding that charge back is what FFO does. Approximate FFO here: net income plus depreciation and amortization — it excludes property-sale gains and impairments, which this data source does not carry, so a year with large disposals reads high. Supporting rather than core for exactly that reason: the frame is the right one for the sector, the figure is an approximation of it. Only applies to Real Estate (see sectorApplicability.ts).",
  },
  price_to_ffo: {
    verdict: "supporting",
    rationale:
      "The real-estate sector's standard valuation multiple, and this app's replacement for the P/E it excludes there. Same approximation as FFO Yield: net income plus depreciation and amortization, without the property-sale-gain and impairment adjustments the NAREIT definition includes — read it as an estimate of the multiple, not a reported one, and alongside P/B and EV/EBITDA rather than alone. Suppressed entirely when approximate FFO is zero or negative, since a negative multiple describes nothing. Only applies to Real Estate (see sectorApplicability.ts).",
  },
  shareholder_yield_valuation: {
    verdict: "supporting",
    rationale:
      "Captures total capital actually returned to shareholders (dividends + buybacks, net of dilution) relative to market cap — a good complement to pure valuation multiples since it shows whether management is returning value, not just what the stock costs.",
  },

  // --- Profitability ---
  roic: {
    verdict: "core",
    rationale:
      "Buffett and Munger's favorite single profitability number — return on all capital employed (debt plus equity), independent of financing choices. Arguably the best single metric in this whole registry for identifying quality businesses.",
  },
  roe: {
    verdict: "caveat",
    rationale:
      "Classic but easily gamed — a company can boost ROE simply by taking on more debt without improving the underlying business at all. Should always be read alongside leverage (Debt/Equity), never in isolation.",
  },
  roa: {
    verdict: "supporting",
    rationale:
      "A simpler cousin of ROIC that ignores capital structure (uses total assets, not invested capital) — less precise, but a useful sanity check, especially for asset-heavy businesses.",
  },
  gross_margin: {
    verdict: "core",
    rationale:
      "Reveals pricing power directly — high, durable gross margins are a hallmark of Buffett-style \"moat\" thinking, since competitors in a commodity business can't sustain wide gaps.",
  },
  operating_margin: {
    verdict: "core",
    rationale: "Adds operating-cost discipline to gross margin's pricing-power signal — together they show both competitive position and management execution.",
  },
  net_margin: {
    verdict: "supporting",
    rationale:
      "Useful headline profitability figure, but more exposed to below-the-line noise (taxes, one-offs, financing costs) than gross or operating margin — treat as a summary stat, not the primary read.",
  },
  fcf_margin: {
    verdict: "core",
    rationale: "A cash-based version of net margin — often more reliable, since it can't be inflated by non-cash accounting entries the way net income can.",
  },
  gross_profitability: {
    verdict: "core",
    rationale:
      "Novy-Marx's 2013 result, and one of the better-replicated quality measures in the academic literature: gross profit scaled by assets has historically separated forward returns at least as well as bottom-line profitability measures, and — unlike most quality signals — it has tended to complement cheapness rather than duplicate it, since profitable companies are usually the expensive ones. Gross profit sits high enough on the income statement to be relatively insulated from the accounting choices (depreciation policy, one-offs, capitalization) that move net income. The honest caveat is scale: an asset-light software company and a utility have structurally different levels here for reasons that aren't about investment quality, so it reads best within an industry. Core rather than supporting because the evidence base is strong and the input (gross profit over total assets) is about as hard to distort as this registry gets.",
  },

  // --- Cash Generation ---
  ocf_margin: { verdict: "core", rationale: "Direct cash generation relative to sales — sound and hard to manipulate." },
  fcf_to_revenue: { verdict: "core", rationale: "Same idea as OCF margin, net of reinvestment (capex) — shows how much of every sales dollar becomes cash the business can actually deploy or return." },
  fcf_to_net_income: {
    verdict: "core",
    rationale:
      "An earnings-quality check in disguise: if free cash flow consistently falls short of net income, it's often a red flag for aggressive revenue recognition or working-capital games — a classic short-seller checklist item.",
  },
  cash_conversion_ratio: {
    verdict: "core",
    rationale: "Same purpose as FCF/Net Income but pre-capex (operating cash flow vs. net income) — persistently low readings are worth investigating before trusting reported earnings.",
  },

  // --- Financial Strength ---
  cash_to_market_cap: {
    verdict: "core",
    rationale: "A direct measure of downside cushion relative to what you're paying — real, immediately available optionality if opportunities (or trouble) arise.",
  },
  net_cash_to_market_cap: {
    verdict: "core",
    rationale: "The more complete version of Cash/Market Cap (nets out debt) — a company with more cash than debt relative to its price has real balance-sheet safety, not just gross cash on hand.",
  },
  debt_to_equity: {
    verdict: "caveat",
    rationale:
      "A classic leverage check. Lower is generally safer, but some leverage is normal and healthy for stable-cashflow businesses (utilities, REITs) — industry context matters more than any single threshold.",
  },
  current_ratio: {
    verdict: "supporting",
    rationale:
      "Short-term liquidity — can the company meet obligations due within a year? Useful as a red-flag screen; very high ratios can also just mean idle, unproductively-deployed capital rather than genuine strength.",
  },
  quick_ratio: { verdict: "supporting", rationale: "Stricter version of the current ratio (excludes inventory) — same caveat about very high readings not automatically being a virtue." },
  interest_coverage: {
    verdict: "core",
    rationale: "Can the company comfortably service its debt from operating profit? A cheap stock with weak coverage is a much riskier bet than its valuation multiple alone suggests.",
  },
  debt_to_ebitda: {
    verdict: "caveat",
    rationale: "Same purpose as Debt/Equity from a different angle (debt vs. cash-flow-generating capacity rather than book equity) — same industry-context caveat applies.",
  },
  debt_maturity_mix: {
    verdict: "supporting",
    rationale:
      "A company with mostly long-term debt has less refinancing risk than one with a wall of near-term maturities, even at identical total debt — a real but often-overlooked risk factor.",
  },

  // --- Capital Allocation ---
  dividend_yield: { verdict: "core", rationale: "Direct, verifiable cash return to shareholders — hard to fake, unlike accounting earnings." },
  dividend_cagr_3y: { verdict: "core", rationale: "Growing dividends over time signal management's confidence in durable, growing earnings power, not just a one-time payout." },
  buyback_yield: {
    verdict: "caveat",
    rationale:
      "Buybacks only create value when done below intrinsic value (Buffett's own explicit test) — this metric can't distinguish disciplined buybacks from value-destroying ones done at inflated prices near market tops.",
  },
  shareholder_yield_capalloc: { verdict: "supporting", rationale: "Combines dividends, buybacks, and dilution into one figure — directionally useful, but inherits buyback yield's inability to judge whether repurchases were smart." },
  share_count_change: {
    verdict: "caveat",
    rationale:
      "A falling share count is good when driven by disciplined buybacks at reasonable prices, but can also just offset ongoing option/RSU dilution rather than truly returning capital — worth checking alongside profitability trends.",
  },
  capex_to_revenue: {
    verdict: "caveat",
    rationale:
      "Lower can mean a more capital-light, higher-return business, but can also mean under-investment that shows up as declining competitiveness later. Best read alongside margin trends, not standalone.",
  },

  // --- Efficiency ---
  asset_turnover: { verdict: "supporting", rationale: "How much revenue a company generates per dollar of assets — most meaningful compared within a sector; a grocery chain and a software company have nothing in common on this metric." },
  inventory_turnover: { verdict: "supporting", rationale: "Same sector-relative caveat as asset turnover — a useful operational-quality check within an industry, not across the whole universe." },
  receivable_turnover: { verdict: "supporting", rationale: "How quickly a company collects what it's owed — sector-relative, and a sudden slowdown can be an early earnings-quality warning sign." },
  cash_conversion_cycle: {
    verdict: "core",
    rationale:
      "One of the few metrics in this registry where a negative value is the best possible outcome, not a red flag — a negative cycle (like Amazon or Costco) means suppliers are effectively financing the business's inventory.",
  },

  // --- Earnings Quality ---
  accrual_ratio: {
    verdict: "core",
    rationale:
      "Sloan's accrual anomaly, almost directly implemented — lower (or negative) accruals mean earnings are backed by real cash, historically associated with better forward stock performance. One of the most academically validated metrics in this whole registry.",
  },
  asset_growth: {
    verdict: "supporting",
    rationale:
      "The asset-growth (or \"investment\") factor from Cooper, Gulen & Schill (2008), later formalized as the conservative-investment leg of the Fama-French five-factor model: companies that expand their balance sheets fastest have historically gone on to earn lower returns than companies that expand slowly, which is why lower is scored better here. It belongs alongside accruals rather than in the growth category — it is a statement about the balance sheet inflating, not about the business compounding. Supporting rather than core for two honest reasons: it is a blunt instrument that cannot tell a well-timed acquisition or a genuinely needed capacity build from empire-building, and it points the opposite way to this registry's growth metrics, so a fast-growing company is scored twice on the same fact with opposite signs. One year of asset change is also noisy — the signal in the literature is strongest over longer windows than five annual statements comfortably support.",
  },
  net_operating_assets: {
    verdict: "supporting",
    rationale:
      "Hirshleifer, Hou, Teoh & Zhang (2004) — balance-sheet bloat. The idea extends Sloan's accrual anomaly from one year's flow to the accumulated stock: if reported earnings have exceeded cash generation for years, the difference piles up somewhere on the asset side, and a high level of net operating assets relative to the asset base has historically predicted weaker subsequent returns more persistently than a single year's accrual ratio. Supporting rather than core purely because of the construction available here: operating and financing items aren't separately reported in this dataset, so the ratio is assembled as equity plus debt minus cash, and this dataset's debt figure is long-term only — a company funded with short-term borrowings therefore reads lower than it should. The frame is the right one; the figure is an approximation of it, so it is weighted as one.",
  },
  fcf_exceeds_net_income: { verdict: "core", rationale: "A simple binary version of the same idea as the accrual ratio — cash-backed earnings are higher quality than accrual-heavy earnings." },
  gross_margin_stability: { verdict: "supporting", rationale: "Stable margins over time suggest pricing power or a moat, rather than exposure to commodity-like competition or one-off swings." },
  operating_margin_stability: { verdict: "supporting", rationale: "Same idea as gross margin stability, one level further down the income statement — adds cost-discipline consistency to the read." },
  revenue_volatility: {
    verdict: "caveat",
    rationale: "Lower volatility suggests a more predictable, forecastable business (Buffett's stated preference), but can also just mean a mature, slow-growth company — read alongside growth metrics, not standalone.",
  },
  eps_volatility: { verdict: "caveat", rationale: "Same idea as revenue volatility, but EPS is also affected by share-count and leverage changes, so it's a noisier signal of the underlying business." },
  piotroski_f_score: {
    verdict: "core",
    rationale:
      "Piotroski's original 2000 paper designed this exact 9-point composite specifically to separate improving from deteriorating cheap (low P/B) stocks — squarely this app's use case. Each point is a concrete year-over-year improvement (profitability, leverage, liquidity, efficiency), so a high score is real, checkable evidence, not just a single ratio's snapshot.",
  },

  // --- Moat ---
  avg_roic_5y: { verdict: "core", rationale: "Sustained high returns on capital over a full 5-year window are much stronger moat evidence than a single good year — this is the right way to measure durability, not just level." },
  avg_gross_margin_5y: { verdict: "core", rationale: "Same durability logic as 5-year ROIC, applied to pricing power specifically." },
  avg_operating_margin_5y: { verdict: "core", rationale: "Same durability logic again, one level further down the income statement." },
  rnd_to_revenue: {
    verdict: "caveat",
    rationale:
      "Direction changed 2026-08-08 to match capex_to_revenue's treatment of reinvestment intensity: Buffett has repeatedly favored businesses that DON'T need heavy reinvestment (R&D included) to defend their position — rewarding higher R&D spend contradicted that and was inconsistent with how this app treats CapEx, a structurally identical \"cash the company must reinvest, as % of revenue\" concept. Still genuinely sector-dependent (pharma/tech companies often need sustained R&D just to survive, so low R&D isn't automatically a stronger moat there) — read alongside margin trends and industry context, not standalone.",
  },
  intangible_assets_pct: {
    verdict: "caveat",
    rationale:
      "Can reflect real brand or IP value (a moat), or just be the accounting residue of overpaying for past acquisitions (goodwill) — this metric alone genuinely can't tell the difference.",
  },
};

/** Growth metrics are generated per line-item x horizon (see functions/src/metrics/definitions.ts); one rationale per line item covers all three horizons, plus a shared note on horizon length. */
export const GROWTH_ITEM_RATIONALE: Record<string, MetricRationaleEntry> = {
  revenue: {
    verdict: "supporting",
    rationale: "Top-line growth alone says nothing about profitability — always pair with margin metrics, never read standalone.",
  },
  netIncome: {
    verdict: "caveat",
    rationale: "Can be inflated by buybacks (fewer shares) or one-off items, especially over short horizons — the 5-year figure is meaningfully more reliable than the 1-year one.",
  },
  eps: {
    verdict: "caveat",
    rationale: "Same caveat as net income growth, plus direct sensitivity to share-count changes — a company can show EPS growth from buybacks alone while the underlying business stalls.",
  },
  operatingCashFlow: {
    verdict: "core",
    rationale: "Cash-based growth is harder to manipulate than earnings-based growth — generally the most trustworthy growth metric in this category.",
  },
  freeCashFlow: {
    verdict: "core",
    rationale: "Same trust advantage as operating cash flow growth, net of reinvestment — arguably the single best growth figure to weight most heavily.",
  },
  bookValue: {
    verdict: "caveat",
    rationale:
      "Buffett's own preferred long-run scorecard (Berkshire reports book value growth) — but for a typical company, buybacks can shrink book value even in a great year, so a low or negative reading here isn't automatically bad.",
  },
};

export const GROWTH_HORIZON_NOTE = "1-year figures are noisier (one bad or one lucky quarter can dominate); the 5-year CAGR is the more reliable read for a durability judgment.";

export function getMetricRationale(key: string, category: MetricCategory): MetricRationaleEntry {
  const direct = METRIC_RATIONALE[key];
  if (direct) return direct;

  const growthMatch = /^growth_([a-zA-Z]+)_\d+y$/.exec(key);
  if (growthMatch) {
    const item = GROWTH_ITEM_RATIONALE[growthMatch[1]];
    if (item) return item;
  }

  return { verdict: CATEGORY_RATIONALE[category].verdict, rationale: "No metric-specific note yet — see the category summary above." };
}
