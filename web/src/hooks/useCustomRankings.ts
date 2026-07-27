import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricCategory, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG } from "@proverbs/shared";
import { computeClientRankings, loadRankingUniverse } from "../lib/clientRankingEngine";
import { useMetricDefinitions } from "./useMetricDefinitions";
import { usePageState } from "./usePageState";

/**
 * Drives the "years of data" / custom-weights sliders on the Home and
 * Company pages. Recomputes instantly in the browser against a bulk raw-data
 * export (see web/src/lib/clientRankingEngine.ts) instead of round-tripping
 * to a callable — the export is fetched once per page session and cached in
 * module scope, so every slider tweak after the first is pure local
 * computation (milliseconds, not the ~25s the old server round-trip took).
 *
 * `persistKey`, when given, keeps `config` alive across the caller
 * unmounting and remounting (e.g. navigating away from Rankings and back)
 * instead of resetting to defaults — and re-derives `results` from it on the
 * next mount, which is cheap now that the universe fetch is cached too.
 */
export function useCustomRankings(persistKey?: string) {
  const { data: metricDefinitions } = useMetricDefinitions();
  // Always the same hook shape regardless of whether persistKey is given (Rules of Hooks) — when
  // it's absent, fall back to a key unique to this mount, which is equivalent to plain useState
  // since nothing else will ever read or write that key.
  const ephemeralKeyRef = useRef(`__ephemeral-${Math.random()}`);
  const [config, setConfig] = usePageState<RankingWeightsConfig>(
    persistKey ?? ephemeralKeyRef.current,
    DEFAULT_RANKING_CONFIG,
  );
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

  // Restores results for a config carried over from a previous mount (see persistKey above).
  // Only fires once per mount, and only when there's actually a non-default config to restore.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !metricDefinitions || config === DEFAULT_RANKING_CONFIG) return;
    restoredRef.current = true;
    void recompute(config);
  }, [metricDefinitions, config, recompute]);

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
