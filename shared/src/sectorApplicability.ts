/**
 * Which metrics are *structurally inapplicable* to a sector — not "usually missing", but
 * meaningless if they happened to compute.
 *
 * Two directions, both resolved by inapplicabilityReason():
 *   - EXCLUDED (SECTOR_INAPPLICABLE_METRICS): a general-purpose metric that breaks down for one
 *     sector. Applicable everywhere else, including for companies with no sector on record.
 *   - RESTRICTED (SECTOR_RESTRICTED_METRICS): a sector-specific metric that only describes one
 *     sector — the inverse case, listed once by the sectors it applies TO rather than by every
 *     sector it doesn't.
 *
 * Banks, insurers and REITs make up roughly a fifth of a 1,300-name mid/large-cap universe, and
 * most of the registry's operating-company metrics either don't compute for them (the line items
 * don't exist) or compute into a number that doesn't describe the business. Without this layer
 * the engine can't tell "this metric is meaningless here" from "this data point happened to be
 * missing", so a bank scored on two metrics and a manufacturer scored on sixty both emit an
 * equally confident 0-100.
 *
 * The bar for listing a metric here is high on purpose: a metric goes in only when the accounting
 * makes it meaningless, never when it's merely unusual or hard to interpret. Anything genuinely
 * arguable stays applicable rather than being silently dropped — under-listing costs a little
 * precision, over-listing hides real information.
 */

export interface InapplicableMetricGroup {
  /** Short, neutral, plain-language explanation — describes the accounting, never judges the company. */
  reason: string;
  metricKeys: string[];
}

export const SECTOR_INAPPLICABLE_METRICS: Record<string, InapplicableMetricGroup[]> = {
  // Banks, insurers, brokers. Their balance sheet *is* the product: deposits, policy reserves
  // and wholesale funding are raw material, not financing choices, and there is no operating
  // cycle of inventory -> receivables -> cash sitting behind revenue.
  Financials: [
    {
      reason:
        "enterprise value is not a meaningful numerator for deposit-funded businesses, where debt and deposits are raw material rather than capital structure",
      metricKeys: ["ev_ebit", "ev_ebitda", "ev_fcf", "earnings_yield"],
    },
    {
      reason:
        "there is no capex-driven free cash flow for a lending or underwriting business, so cash-flow-to-revenue measures do not describe how it generates cash",
      metricKeys: [
        "fcf_yield",
        "fcf_margin",
        "fcf_to_revenue",
        "fcf_to_net_income",
        "cash_conversion_ratio",
        "ocf_margin",
        "capex_to_revenue",
      ],
    },
    {
      reason:
        "invested capital is not separable from the funding a financial business runs on, so returns on it cannot be measured the usual way",
      metricKeys: ["roic", "avg_roic_5y"],
    },
    {
      reason:
        "liquidity and leverage ratios written for operating companies do not describe a regulated balance sheet, where leverage is the business model and capital adequacy is the real constraint",
      metricKeys: [
        "current_ratio",
        "quick_ratio",
        "debt_to_equity",
        "debt_to_ebitda",
        "interest_coverage",
        "debt_maturity_mix",
        "net_cash_to_market_cap",
        "cash_to_market_cap",
      ],
    },
    {
      reason:
        "turnover measures assume inventory and trade receivables from an operating cycle that financial businesses do not have",
      metricKeys: ["asset_turnover", "inventory_turnover", "receivable_turnover", "cash_conversion_cycle"],
    },
  ],

  // REITs. Far closer to operating companies than banks are — enterprise value, debt/EBITDA and
  // interest coverage are all standard, defensible ways to look at a property portfolio, so they
  // stay applicable. Only two things genuinely break down: reported earnings, and the working
  // capital cycle.
  "Real Estate": [
    {
      reason:
        "reported earnings are dominated by property depreciation, a non-cash charge on assets that often appreciate — this is why the industry reports FFO instead",
      metricKeys: ["pe_ttm"],
    },
    {
      reason: "a property portfolio has no inventory or trade-receivable cycle to turn over",
      metricKeys: ["inventory_turnover", "receivable_turnover", "cash_conversion_cycle"],
    },
  ],
};

/**
 * The inverse of SECTOR_INAPPLICABLE_METRICS: metrics built on one sector's own reporting
 * convention, which describe nothing outside it. Listing them by the sectors they apply TO keeps
 * a sector-specific metric from having to be repeated under every other sector — and keeps the
 * default for a new sector-specific metric at "restricted", not "applied to all 1,300 names".
 *
 * The bar is the same as the exclusion list's, read the other way round: a metric belongs here
 * only when the number it produces outside its sectors describes nothing real (a software
 * company's price-to-FFO is just its P/E with depreciation added back for no reason), never
 * merely because the metric is most *interesting* in one sector.
 */
export interface RestrictedMetricGroup {
  /** Canonical sector names — exactly the values canonicalSector() produces (see SECTOR_ALIASES). */
  sectors: string[];
  /** Same neutral, plain-language contract as InapplicableMetricGroup.reason. */
  reason: string;
  metricKeys: string[];
}

export const SECTOR_RESTRICTED_METRICS: RestrictedMetricGroup[] = [
  {
    sectors: ["Real Estate"],
    reason:
      "funds from operations is a real-estate reporting convention — it adds back property depreciation, which is only the dominant non-cash charge when the company's principal assets are properties",
    metricKeys: ["ffo_yield", "price_to_ffo"],
  },
];

/**
 * Sector strings reach the engine from two providers that disagree on wording (SEC EDGAR's SIC
 * mapping says "Financials", Yahoo's profile says "Financial Services"), so match on a normalized
 * form. Anything unrecognized falls through to "no sector applicability rules", which is the safe
 * direction: an unknown sector is never penalized.
 */
const SECTOR_ALIASES: Record<string, string> = {
  financials: "Financials",
  financial: "Financials",
  "financial services": "Financials",
  "financial service": "Financials",
  banks: "Financials",
  banking: "Financials",
  insurance: "Financials",
  insurers: "Financials",
  "real estate": "Real Estate",
  realestate: "Real Estate",
  reit: "Real Estate",
  reits: "Real Estate",
};

function canonicalSector(sector: string | null | undefined): string | null {
  if (!sector) return null;
  const normalized = sector.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return SECTOR_ALIASES[normalized] ?? null;
}

const REASON_BY_SECTOR: Map<string, Map<string, string>> = new Map(
  Object.entries(SECTOR_INAPPLICABLE_METRICS).map(([sector, groups]) => [
    sector,
    new Map(groups.flatMap((g) => g.metricKeys.map((key) => [key, g.reason] as const))),
  ]),
);

const RESTRICTED_BY_METRIC: Map<string, RestrictedMetricGroup> = new Map(
  SECTOR_RESTRICTED_METRICS.flatMap((group) => group.metricKeys.map((key) => [key, group] as const)),
);

/**
 * Appended when a *restricted* metric meets a company carrying no sector at all. The two
 * directions treat a missing sector oppositely, on purpose:
 *
 *   - An EXCLUDED metric stays applicable, because dropping it would remove real information
 *     from a company on nothing more than a missing sector label — the "never penalize unknown"
 *     rule.
 *   - A RESTRICTED metric is withheld, because applying it requires positive evidence that the
 *     company is one of the sectors it describes, and "no sector on record" is not that
 *     evidence. Withholding costs the company nothing: an inapplicable metric leaves the
 *     coverage denominator as well as the score, and keeps the company out of the metric's peer
 *     distribution — so a sector-less name is neither scored on nor scored against a REIT-only
 *     multiple, and doesn't dilute the REIT peer group either.
 */
const NO_SECTOR_CLAUSE = ", and this company has no sector on record to check it against";

/** True when the provider gave us *something*, whether or not this module recognizes the wording. */
function hasSectorOnRecord(sector: string | null | undefined): boolean {
  return typeof sector === "string" && sector.trim() !== "";
}

/**
 * The short plain-language reason this metric is structurally inapplicable to this sector, or
 * null when it applies normally.
 *
 * For an excluded metric an unrecognized or missing sector always returns null — never penalize
 * a company for a sector we can't read. For a restricted metric the same sector returns a reason
 * instead, since only a positive sector match can make it applicable; see NO_SECTOR_CLAUSE for
 * why the asymmetry is deliberate. Note SECTOR_ALIASES only recognizes the gated sectors, so a
 * "Technology" company and a sector-less one both canonicalize to null — they differ only in
 * which reason text they get back.
 */
export function inapplicabilityReason(metricKey: string, sector: string | null): string | null {
  const canonical = canonicalSector(sector);

  const restricted = RESTRICTED_BY_METRIC.get(metricKey);
  if (restricted) {
    if (canonical !== null && restricted.sectors.includes(canonical)) return null;
    return hasSectorOnRecord(sector) ? restricted.reason : `${restricted.reason}${NO_SECTOR_CLAUSE}`;
  }

  if (canonical === null) return null;
  return REASON_BY_SECTOR.get(canonical)?.get(metricKey) ?? null;
}

/** False only when the metric is structurally meaningless for this sector (see inapplicabilityReason). */
export function isMetricApplicable(metricKey: string, sector: string | null): boolean {
  return inapplicabilityReason(metricKey, sector) === null;
}
