import { useCallback, useState } from "react";
import type { MetricCategory, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG } from "@proverbs/shared";
import { computeClientRankings, loadRankingUniverse } from "../lib/clientRankingEngine";
import { useMetricDefinitions } from "./useMetricDefinitions";

/**
 * Drives the "years of data" / custom-weights sliders on the Home and
 * Company pages. Recomputes instantly in the browser against a bulk raw-data
 * export (see web/src/lib/clientRankingEngine.ts) instead of round-tripping
 * to a callable — the export is fetched once per page session and cached in
 * module scope, so every slider tweak after the first is pure local
 * computation (milliseconds, not the ~25s the old server round-trip took).
 */
export function useCustomRankings() {
  const { data: metricDefinitions } = useMetricDefinitions();
  const [config, setConfig] = useState<RankingWeightsConfig>(DEFAULT_RANKING_CONFIG);
  const [results, setResults] = useState<RankingResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recompute = useCallback(
    async (nextConfig: RankingWeightsConfig) => {
      // Metric definitions back the weight sliders themselves, so by the time a user can
      // trigger a recompute they're already loaded via react-query's cache.
      if (!metricDefinitions) return;
      setLoading(true);
      setError(null);
      try {
        const { universe } = await loadRankingUniverse();
        setResults(computeClientRankings(universe, metricDefinitions, nextConfig));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to recompute rankings.");
      } finally {
        setLoading(false);
      }
    },
    [metricDefinitions],
  );

  function setYearsIncluded(years: 1 | 2 | 3 | 4 | 5) {
    const next = { ...config, yearsIncluded: years };
    setConfig(next);
    return next;
  }

  function setCategoryWeight(category: MetricCategory, weight: number) {
    const next = { ...config, categoryWeights: { ...config.categoryWeights, [category]: weight } };
    setConfig(next);
    return next;
  }

  function setMetricWeight(metricKey: string, weight: number) {
    const next = { ...config, metricWeights: { ...config.metricWeights, [metricKey]: weight } };
    setConfig(next);
    return next;
  }

  function resetMetricWeights() {
    const next = { ...config, metricWeights: undefined };
    setConfig(next);
    return next;
  }

  return {
    config,
    setConfig,
    results,
    loading,
    error,
    recompute,
    setYearsIncluded,
    setCategoryWeight,
    setMetricWeight,
    resetMetricWeights,
  };
}
