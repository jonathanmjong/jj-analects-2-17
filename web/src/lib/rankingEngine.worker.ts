/// <reference lib="webworker" />
import type {
  MetricDefinition,
  RankingResult,
  RankingWeightsConfig,
  UniverseCompanyData,
  UnitScoreIndex,
} from "@proverbs/shared";
import { aggregateRankings, computeUnitScores } from "@proverbs/shared";
import { reshapeUniverse, type RankingUniverseExport } from "./rankingUniverseShape";

/**
 * Runs the identical shared ranking algorithm the main thread would, off the
 * main thread, so dragging a weight slider never blocks paint.
 *
 * The universe is posted once ("init", in its compact parallel-array wire
 * shape — a fraction of the structured-clone cost of the expanded form) and
 * kept here; every recompute posts only the config. Metric definitions are
 * likewise cached and only re-sent when they actually change.
 */

type IncomingMessage =
  | { type: "init"; exportData: RankingUniverseExport; metrics: MetricDefinition[] | null }
  | { type: "compute"; id: number; config: RankingWeightsConfig; metrics?: MetricDefinition[] };

export type WorkerOutgoingMessage =
  | { type: "ready" }
  | { type: "result"; id: number; results: RankingResult[] }
  | { type: "error"; id: number | null; message: string };

let universe: UniverseCompanyData[] | null = null;
let metricDefinitions: MetricDefinition[] | null = null;

/**
 * Normalization (winsorize + percentile/z-score per metric-year) is by far the
 * expensive half and depends only on the universe, the metric definitions and
 * the four config fields below — NOT on category/metric weights. Dragging a
 * weight slider therefore only needs the aggregation half, so the index is
 * cached and reused until one of its real inputs changes.
 */
let unitScoreCache: { index: UnitScoreIndex; key: string; metrics: MetricDefinition[] } | null = null;

function unitScoreKey(config: RankingWeightsConfig): string {
  return [config.yearsIncluded, config.winsorizeLowerPct, config.winsorizeUpperPct, config.normalizationMethod].join("|");
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerOutgoingMessage): void {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      universe = reshapeUniverse(message.exportData);
      if (message.metrics) metricDefinitions = message.metrics;
      unitScoreCache = null;
      post({ type: "ready" });
      return;
    }
    if (message.metrics) {
      metricDefinitions = message.metrics;
      unitScoreCache = null; // different metric set ⇒ a different normalization
    }
    if (!universe || !metricDefinitions) {
      post({ type: "error", id: message.id, message: "Ranking worker received a compute before its universe." });
      return;
    }
    const key = unitScoreKey(message.config);
    if (!unitScoreCache || unitScoreCache.key !== key || unitScoreCache.metrics !== metricDefinitions) {
      unitScoreCache = {
        index: computeUnitScores(universe, metricDefinitions, message.config),
        key,
        metrics: metricDefinitions,
      };
    }
    const results = aggregateRankings(universe, metricDefinitions, message.config, unitScoreCache.index).results;
    post({ type: "result", id: message.id, results });
  } catch (err) {
    post({
      type: "error",
      id: message.type === "compute" ? message.id : null,
      message: err instanceof Error ? err.message : "Ranking worker failed.",
    });
  }
};
