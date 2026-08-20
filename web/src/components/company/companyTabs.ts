export const COMPANY_TAB_IDS = ["overview", "valuation", "quality", "financials", "metrics", "sentiment"] as const;

export type CompanyTabId = (typeof COMPANY_TAB_IDS)[number];

export interface CompanyTabDefinition {
  id: CompanyTabId;
  label: string;
  /** One line stating what question the section answers — the panels below it are
   * the evidence, and a section of raw panels with no stated purpose is a data dump. */
  summary: string;
}

export const COMPANY_TABS: readonly CompanyTabDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    summary: "What the business is, and how the model scores it against its sector.",
  },
  {
    id: "valuation",
    label: "Valuation",
    summary: "What today's price already assumes, and what would have to be true to justify it.",
  },
  {
    id: "quality",
    label: "Quality & Risk",
    summary: "How the business is run, and what to check before trusting its reported numbers.",
  },
  {
    id: "financials",
    label: "Financials",
    summary: "The as-reported annual statements every other section is derived from.",
  },
  {
    id: "metrics",
    label: "Metrics",
    summary: "Every metric in the model, per fiscal year, with its percentile against peers.",
  },
  {
    id: "sentiment",
    label: "Sentiment",
    summary: "Recent headline tone — a directional signal, not part of the score.",
  },
];

export const DEFAULT_COMPANY_TAB: CompanyTabId = "overview";

export interface CompanyTabDataPresence {
  ticker: string;
  /** Any annual income / balance / cash-flow statement was ingested. */
  hasStatements: boolean;
  /** At least one scored period, i.e. the metric breakdown has rows to show. */
  hasMetricScores: boolean;
  hasSentiment: boolean;
}

/**
 * Why only three tabs can report empty: the analysis panels (valuation, forensic,
 * capital allocation, …) each state their own reason when they can't compute, so
 * those sections are never blank. These three render raw data directly, and with
 * no data they would otherwise be an empty pane.
 */
export function companyTabEmptyReason(tab: CompanyTabId, presence: CompanyTabDataPresence): string | null {
  const { ticker } = presence;
  switch (tab) {
    case "financials":
      return presence.hasStatements ? null : `No annual financial statements have been ingested for ${ticker} yet.`;
    case "metrics":
      return presence.hasMetricScores ? null : `No metric scores have been computed for ${ticker} yet.`;
    case "sentiment":
      return presence.hasSentiment ? null : `No news sentiment has been collected for ${ticker} yet.`;
    default:
      return null;
  }
}
