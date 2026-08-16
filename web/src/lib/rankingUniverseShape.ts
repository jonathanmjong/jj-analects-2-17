import type { UniverseCompanyData } from "@proverbs/shared";

/**
 * Wire shape of public/ranking-universe.json.gz (see
 * functions/src/ranking/exportUniverseData.ts): one shared metric-key list plus
 * parallel numeric arrays per company/year, rather than repeating ~74 key
 * strings 6,700 times.
 *
 * Lives in its own module (not clientRankingEngine.ts) because the ranking Web
 * Worker needs the same shape and reshaping code: importing it from
 * clientRankingEngine would drag the Firebase Storage SDK into the worker
 * bundle for nothing.
 */
export interface RankingUniverseExport {
  computedAt: string;
  metricKeys: string[];
  companies: Array<{ ticker: string; sector: string | null; byYear: Array<Array<number | null>> }>;
}

/**
 * Expands the parallel-array export into the Record-keyed shape the ranking
 * engine expects. ~1,300 companies x 5 years x 74 metrics is ~500k object
 * properties, so this is the single largest allocation the client makes —
 * it belongs on the worker thread whenever one is available.
 */
export function reshapeUniverse(exportData: RankingUniverseExport): UniverseCompanyData[] {
  const keys = exportData.metricKeys;
  return exportData.companies.map((c) => ({
    ticker: c.ticker,
    sector: c.sector,
    byYear: c.byYear.map((yearValues) => {
      const record: Record<string, number | null> = {};
      for (let i = 0; i < keys.length; i++) record[keys[i]] = yearValues[i] ?? null;
      return record;
    }),
  }));
}

/**
 * Only the most recent year, which is all the formula filter and preset screens
 * read — a fifth of the work and allocation of reshapeUniverse.
 */
export function latestYearMetricsByTicker(
  exportData: RankingUniverseExport,
): Map<string, Record<string, number | null>> {
  const keys = exportData.metricKeys;
  const byTicker = new Map<string, Record<string, number | null>>();
  for (const c of exportData.companies) {
    const values = c.byYear[0];
    if (!values) continue;
    const record: Record<string, number | null> = {};
    for (let i = 0; i < keys.length; i++) record[keys[i]] = values[i] ?? null;
    byTicker.set(c.ticker, record);
  }
  return byTicker;
}
