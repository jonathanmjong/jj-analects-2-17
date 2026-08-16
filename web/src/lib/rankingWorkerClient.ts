import type { MetricDefinition, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import type { RankingUniverseExport } from "./rankingUniverseShape";
import type { WorkerOutgoingMessage } from "./rankingEngine.worker";

/**
 * Main-thread half of the ranking Web Worker (see rankingEngine.worker.ts).
 *
 * Three properties this module exists to guarantee:
 *  - The universe crosses the thread boundary once per fetched export, in its
 *    compact wire shape. Every recompute after that posts only the config.
 *  - Latest wins. Dragging a slider produces a burst of requests; at most one
 *    is in flight and at most one is waiting, and anything older resolves
 *    "superseded" so the caller drops it instead of the worker grinding
 *    through a queue of results nobody will see.
 *  - Any failure — no Worker constructor (jsdom/tests), a blocked module
 *    fetch, a runtime throw inside the worker — degrades to "unavailable" so
 *    the caller runs the same computation synchronously. The worker is a
 *    performance path, never a correctness dependency.
 */

export type WorkerComputeOutcome =
  | { status: "ok"; results: RankingResult[] }
  | { status: "superseded" }
  | { status: "unavailable" };

interface Waiter {
  id: number;
  config: RankingWeightsConfig;
  metrics: MetricDefinition[];
  resolve: (outcome: WorkerComputeOutcome) => void;
}

/** A worker that never answers its init would leave the UI on "recomputing…" forever; fall back instead. */
const INIT_TIMEOUT_MS = 10_000;

let worker: Worker | null = null;
let unavailable = false;
let initializedExport: RankingUniverseExport | null = null;
let initPromise: Promise<void> | null = null;
let postedMetrics: MetricDefinition[] | null = null;
let inFlight: Waiter | null = null;
let queued: Waiter | null = null;
let nextId = 1;

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    const created = new Worker(new URL("./rankingEngine.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => handleMessage(event.data);
    created.onerror = () => markUnavailable();
    created.onmessageerror = () => markUnavailable();
    return created;
  } catch {
    return null;
  }
}

function markUnavailable(): void {
  unavailable = true;
  const pending = [inFlight, queued].filter((w): w is Waiter => w !== null);
  inFlight = null;
  queued = null;
  initializedExport = null;
  postedMetrics = null;
  initPromise = null;
  worker?.terminate();
  worker = null;
  for (const waiter of pending) waiter.resolve({ status: "unavailable" });
}

let resolveInit: (() => void) | null = null;

function handleMessage(message: WorkerOutgoingMessage): void {
  if (message.type === "ready") {
    resolveInit?.();
    resolveInit = null;
    return;
  }
  const waiter = inFlight;
  inFlight = null;
  if (message.type === "error") {
    // A throw inside the engine is not worker-specific — it would fail the same
    // way synchronously — but reporting it as unavailable keeps one code path
    // for "the worker didn't produce results" and lets the caller surface the
    // real error from the sync run.
    markUnavailable();
    waiter?.resolve({ status: "unavailable" });
    return;
  }
  waiter?.resolve(waiter.id === latestRequestId() ? { status: "ok", results: message.results } : { status: "superseded" });
  drain();
}

function latestRequestId(): number {
  return queued?.id ?? inFlight?.id ?? nextId - 1;
}

function drain(): void {
  if (!worker || inFlight || !queued) return;
  const waiter = queued;
  queued = null;
  inFlight = waiter;
  // Resent only when the definitions themselves changed, and only here — marking
  // them sent at request time would lose them if that request were superseded
  // before it ever reached the worker.
  const metrics = postedMetrics === waiter.metrics ? undefined : waiter.metrics;
  postedMetrics = waiter.metrics;
  worker.postMessage({ type: "compute", id: waiter.id, config: waiter.config, metrics });
}

async function ensureInitialized(
  exportData: RankingUniverseExport,
  metrics: MetricDefinition[] | null,
): Promise<boolean> {
  if (unavailable) return false;
  if (!worker) {
    worker = createWorker();
    if (!worker) {
      unavailable = true;
      return false;
    }
  }
  if (initializedExport === exportData && initPromise) {
    await initPromise;
    return !unavailable;
  }
  initializedExport = exportData;
  postedMetrics = metrics;
  initPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      markUnavailable();
      resolve();
    }, INIT_TIMEOUT_MS);
    resolveInit = () => {
      clearTimeout(timer);
      resolve();
    };
    worker?.postMessage({ type: "init", exportData, metrics });
  });
  await initPromise;
  return !unavailable;
}

/**
 * Hands the worker its universe before the user touches a slider, so the first
 * recompute pays only the compute. Safe to call repeatedly; a no-op once the
 * worker holds this export. Never throws — a failed prewarm just means the
 * first real request initializes (or falls back) as it otherwise would.
 */
export async function prewarmRankingWorker(exportData: RankingUniverseExport): Promise<void> {
  try {
    await ensureInitialized(exportData, null);
  } catch {
    /* the worker is optional; a failed prewarm changes nothing */
  }
}

export async function computeRankingsViaWorker(
  exportData: RankingUniverseExport,
  metrics: MetricDefinition[],
  config: RankingWeightsConfig,
): Promise<WorkerComputeOutcome> {
  const ready = await ensureInitialized(exportData, metrics);
  if (!ready || !worker) return { status: "unavailable" };

  return new Promise<WorkerComputeOutcome>((resolve) => {
    const waiter: Waiter = { id: nextId++, config, metrics, resolve };
    // Anything already waiting is now stale: drop it rather than letting the
    // worker compute a result the caller would immediately throw away.
    queued?.resolve({ status: "superseded" });
    queued = waiter;
    drain();
  });
}

/**
 * Drops the worker and everything it holds. Called from
 * clearRankingUniverseCache() — the worker retains the whole
 * Storage-rules-gated universe, so a sign-out that cleared only the main
 * thread's copy would leave the next identity on this tab computing against
 * the previous user's data.
 */
export function terminateRankingWorker(): void {
  worker?.terminate();
  worker = null;
  initializedExport = null;
  initPromise = null;
  resolveInit = null;
  postedMetrics = null;
  const pending = [inFlight, queued].filter((w): w is Waiter => w !== null);
  inFlight = null;
  queued = null;
  for (const waiter of pending) waiter.resolve({ status: "superseded" });
  // A previous failure shouldn't outlive the data it happened on.
  unavailable = false;
}
