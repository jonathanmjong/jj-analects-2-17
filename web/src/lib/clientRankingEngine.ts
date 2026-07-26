import { getBytes, ref } from "firebase/storage";
import type { MetricDefinition, RankingResult, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings } from "@proverbs/shared";
import { storage } from "./firebase";

const EXPORT_PATH = "public/ranking-universe.json.gz";

interface RankingUniverseExport {
  computedAt: string;
  metricKeys: string[];
  companies: Array<{ ticker: string; byYear: Array<Array<number | null>> }>;
}

/**
 * Storage serves the object with Content-Encoding: gzip (see
 * functions/src/ranking/exportUniverseData.ts), which fetch/getBytes'
 * underlying network layer normally decompresses transparently. This is a
 * fallback for environments where that doesn't happen (bytes still gzip
 * magic-numbered) — decompress manually via the native DecompressionStream.
 */
async function decodeExportBytes(bytes: ArrayBuffer): Promise<RankingUniverseExport> {
  const isGzipMagic = bytes.byteLength > 2 && new Uint8Array(bytes, 0, 2).every((b, i) => b === [0x1f, 0x8b][i]);
  if (!isGzipMagic) {
    return JSON.parse(new TextDecoder().decode(bytes)) as RankingUniverseExport;
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as RankingUniverseExport;
}

let inFlight: Promise<{ computedAt: string; universe: UniverseCompanyData[] }> | null = null;

/**
 * Fetches (once per page session, subject to Storage security rules —
 * subscribed users only, see storage.rules) and parses the bulk raw-metric
 * export, converting it into the Record-keyed shape
 * computeCrossSectionalRankings expects. Cached in module scope so every
 * slider tweak after the first reuses the same in-memory universe instead of
 * re-fetching.
 */
export function loadRankingUniverse(): Promise<{ computedAt: string; universe: UniverseCompanyData[] }> {
  if (!inFlight) {
    inFlight = (async () => {
      const bytes = await getBytes(ref(storage, EXPORT_PATH));
      const exportData = await decodeExportBytes(bytes);

      const universe: UniverseCompanyData[] = exportData.companies.map((c) => ({
        ticker: c.ticker,
        byYear: c.byYear.map((yearValues) => {
          const record: Record<string, number | null> = {};
          exportData.metricKeys.forEach((key, idx) => {
            record[key] = yearValues[idx] ?? null;
          });
          return record;
        }),
      }));

      return { computedAt: exportData.computedAt, universe };
    })().catch((err) => {
      inFlight = null; // let a later call retry instead of caching a permanent failure
      throw err;
    });
  }
  return inFlight;
}

/** Instant, in-browser twin of functions/src/ranking/rankingEngine.ts's computeRankings — same shared math, no network round-trip. */
export function computeClientRankings(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): RankingResult[] {
  return computeCrossSectionalRankings(universe, metrics, config).results;
}
