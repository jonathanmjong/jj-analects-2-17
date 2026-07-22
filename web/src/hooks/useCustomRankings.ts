import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";
import type { MetricCategory, RankingResult, RankingWeightsConfig } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG } from "@proverbs/shared";
import { functions } from "../lib/firebase";

/**
 * Drives the "years of data" / custom-weights sliders on the Home and
 * Company pages: calls the recomputeRankingsWithConfig callable with a
 * modified config and returns the recomputed (unpersisted) results, so the
 * UI updates live without waiting for the nightly scheduled job.
 */
export function useCustomRankings() {
  const [config, setConfig] = useState<RankingWeightsConfig>(DEFAULT_RANKING_CONFIG);
  const [results, setResults] = useState<RankingResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recompute = useCallback(async (nextConfig: RankingWeightsConfig) => {
    setLoading(true);
    setError(null);
    try {
      const call = httpsCallable<{ config: RankingWeightsConfig }, { results: RankingResult[] }>(
        functions,
        "recomputeRankingsWithConfig",
      );
      const response = await call({ config: nextConfig });
      setResults(response.data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to recompute rankings.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  return { config, setConfig, results, loading, error, recompute, setYearsIncluded, setCategoryWeight };
}
