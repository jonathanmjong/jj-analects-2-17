import { gzipSync } from "node:zlib";
import { getStorage } from "firebase-admin/storage";
import { log } from "../lib/logger.js";

export interface CompanyYearScores {
  ticker: string;
  sector: string | null;
  /** yearIndex 0 = most recent fiscal year available for this company. */
  byYear: Array<Record<string, number | null>>;
  periodKeys: string[];
}

const EXPORT_PATH = "public/ranking-universe.json.gz";

/**
 * Writes a compact bulk export of every company's raw (pre-normalization)
 * metric values to Cloud Storage, so the Rankings page's live weight sliders
 * can recompute the whole universe's scores instantly in the browser
 * instead of round-tripping to recomputeRankingsWithConfig (~25s at current
 * universe scale). Uses a shared ordered metricKeys list + numeric arrays
 * (instead of repeating key names per company/year) to keep the payload
 * small, then gzips it — web/src/lib/clientRankingEngine.ts is the
 * client-side counterpart that consumes this exact shape.
 */
export async function persistClientRankingExport(universe: CompanyYearScores[], metricKeys: string[]): Promise<void> {
  const companies = universe.map((c) => ({
    ticker: c.ticker,
    sector: c.sector,
    byYear: c.byYear.map((yearValues) => metricKeys.map((key) => yearValues[key] ?? null)),
  }));

  const payload = JSON.stringify({ computedAt: new Date().toISOString(), metricKeys, companies });
  const gzipped = gzipSync(Buffer.from(payload, "utf-8"));

  const bucket = getStorage().bucket();
  const file = bucket.file(EXPORT_PATH);
  await file.save(gzipped, {
    contentType: "application/json",
    metadata: { contentEncoding: "gzip", cacheControl: "public, max-age=300" },
  });

  log.info(`persistClientRankingExport: wrote ${companies.length} companies, ${gzipped.length} bytes gzipped`);
}
