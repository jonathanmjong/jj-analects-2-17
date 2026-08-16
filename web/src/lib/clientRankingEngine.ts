import type { MetricDefinition, RankingResult, RankingWeightsConfig, UniverseCompanyData } from "@proverbs/shared";
import { computeCrossSectionalRankings } from "@proverbs/shared";
import { loadStorage } from "./firebase";
import { CACHE_VERSION, idbGet, idbSet, isUniverseCacheFresh } from "./idbCache";
import {
  latestYearMetricsByTicker,
  reshapeUniverse,
  type RankingUniverseExport,
} from "./rankingUniverseShape";
import { prewarmRankingWorker, terminateRankingWorker } from "./rankingWorkerClient";

const EXPORT_PATH = "public/ranking-universe.json.gz";

export type { RankingUniverseExport };

/**
 * Storage serves the object with Content-Encoding: gzip (see
 * functions/src/ranking/exportUniverseData.ts), which fetch/getBytes'
 * underlying network layer normally decompresses transparently. This is a
 * fallback for environments where that doesn't happen (bytes still gzip
 * magic-numbered) — decompress manually via the native DecompressionStream.
 */
async function decodeExportBytes(bytes: ArrayBuffer): Promise<RankingUniverseExport> {
  if (bytes.byteLength === 0) {
    throw new Error("Ranking universe export was empty.");
  }
  const isGzipMagic = bytes.byteLength > 2 && new Uint8Array(bytes, 0, 2).every((b, i) => b === [0x1f, 0x8b][i]);
  if (!isGzipMagic) {
    return JSON.parse(new TextDecoder().decode(bytes)) as RankingUniverseExport;
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as RankingUniverseExport;
}

let inFlight: Promise<{ computedAt: string; exportData: RankingUniverseExport }> | null = null;

/**
 * The expanded, engine-ready universe: ~500k object properties, and the single
 * largest allocation the client makes. Derived lazily and only by callers that
 * genuinely need it on this thread (the synchronous fallback path) — when the
 * ranking worker is available the expansion happens there instead, and this
 * stays null for the whole session.
 */
let expandedUniverse: { forExport: RankingUniverseExport; universe: UniverseCompanyData[] } | null = null;
let latestYearMetrics: { forExport: RankingUniverseExport; byTicker: Map<string, Record<string, number | null>> } | null =
  null;

const UNIVERSE_CACHE_KEY = `ranking-universe-${CACHE_VERSION}`;

interface CachedUniverseExport {
  cachedAt: number;
  export: RankingUniverseExport;
}

/**
 * Fetch order: fresh IndexedDB copy (skips the ~2MB download + decompress on
 * every reload) → network (and re-cache) → stale IndexedDB copy as a network-
 * failure fallback (yesterday's rankings beat a broken page). The in-memory
 * module cache still sits on top so slider tweaks never touch IDB either.
 */
async function fetchExportData(): Promise<RankingUniverseExport> {
  const cached = await idbGet<CachedUniverseExport>(UNIVERSE_CACHE_KEY);
  if (cached && isUniverseCacheFresh(cached.cachedAt, Date.now())) {
    return cached.export;
  }
  try {
    const [{ getBytes, ref }, storage] = await Promise.all([import("firebase/storage"), loadStorage()]);
    const bytes = await getBytes(ref(storage, EXPORT_PATH));
    const exportData = await decodeExportBytes(bytes);
    void idbSet(UNIVERSE_CACHE_KEY, { cachedAt: Date.now(), export: exportData } satisfies CachedUniverseExport);
    return exportData;
  } catch (err) {
    if (cached) {
      console.warn("Ranking universe fetch failed; using the previous day's cached copy.", err);
      return cached.export;
    }
    throw err;
  }
}

/**
 * Fetches (once per page session, subject to Storage security rules —
 * subscribed users only, see storage.rules) and parses the bulk raw-metric
 * export in its compact wire shape. Cached in module scope so every slider
 * tweak after the first reuses the same in-memory copy instead of re-fetching.
 */
export function loadRankingUniverseExport(): Promise<{ computedAt: string; exportData: RankingUniverseExport }> {
  if (!inFlight) {
    inFlight = (async () => {
      const exportData = await fetchExportData();
      return { computedAt: exportData.computedAt, exportData };
    })().catch((err) => {
      inFlight = null; // let a later call retry instead of caching a permanent failure
      throw err;
    });
  }
  return inFlight;
}

/** The compact export expanded into the Record-keyed shape computeCrossSectionalRankings expects. */
export async function loadRankingUniverse(): Promise<{ computedAt: string; universe: UniverseCompanyData[] }> {
  const { computedAt, exportData } = await loadRankingUniverseExport();
  if (expandedUniverse?.forExport !== exportData) {
    expandedUniverse = { forExport: exportData, universe: reshapeUniverse(exportData) };
  }
  return { computedAt, universe: expandedUniverse.universe };
}

/**
 * Most recent year's raw metric values per ticker — what the formula filter and
 * preset screens read. A fifth of the expansion work of loadRankingUniverse,
 * which is the only reason the Rankings page ever built the full five years.
 */
export async function loadLatestYearMetrics(): Promise<{
  keys: string[];
  byTicker: Map<string, Record<string, number | null>>;
}> {
  const { exportData } = await loadRankingUniverseExport();
  if (latestYearMetrics?.forExport !== exportData) {
    latestYearMetrics = { forExport: exportData, byTicker: latestYearMetricsByTicker(exportData) };
  }
  return { keys: exportData.metricKeys, byTicker: latestYearMetrics.byTicker };
}

/**
 * Gives the ranking worker its universe while the page is still loading, so the
 * first weight-slider change pays for the computation only. Only worth calling
 * from a page that already loads the export at mount — it must never be the
 * thing that triggers the ~2MB Storage fetch.
 */
export async function prewarmRankingEngine(): Promise<void> {
  const { exportData } = await loadRankingUniverseExport();
  await prewarmRankingWorker(exportData);
}

/**
 * Drops the cached universe fetch. Must be called on sign-out (and on
 * switching to a different account in the same tab) — otherwise the next
 * signed-in user on this tab would silently reuse the previous user's
 * already-fetched (Storage-rules-gated) financial data instead of the
 * fetch being re-authorized under their own token. See
 * web/src/context/AuthProvider.tsx. The worker holds its own copy of the same
 * data, so it has to go too.
 */
export function clearRankingUniverseCache(): void {
  inFlight = null;
  expandedUniverse = null;
  latestYearMetrics = null;
  terminateRankingWorker();
}

/** Instant, in-browser twin of functions/src/ranking/rankingEngine.ts's computeRankings — same shared math, no network round-trip. */
export function computeClientRankings(
  universe: UniverseCompanyData[],
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): RankingResult[] {
  return computeCrossSectionalRankings(universe, metrics, config).results;
}
