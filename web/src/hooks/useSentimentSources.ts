import { useEffect, useState } from "react";
import type { SentimentSourceId } from "@proverbs/shared";
import { SENTIMENT_SOURCES } from "@proverbs/shared";

const STORAGE_KEY = "analects_sentiment_sources";
const AVAILABLE_IDS = SENTIMENT_SOURCES.filter((s) => s.available).map((s) => s.id);

function loadSelected(): SentimentSourceId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return AVAILABLE_IDS;
    const parsed = JSON.parse(raw) as SentimentSourceId[];
    const availableSet = new Set(AVAILABLE_IDS);
    const filtered = parsed.filter((id) => availableSet.has(id));
    return filtered.length > 0 ? filtered : AVAILABLE_IDS;
  } catch {
    return AVAILABLE_IDS;
  }
}

/** Shared (not per-page) so the Sentiment tab and Company page's sentiment card never disagree about which sources are in view. Persisted to localStorage — a genuine cross-session preference, not view state. */
export function useSentimentSources() {
  const [selected, setSelected] = useState<SentimentSourceId[]>(loadSelected);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // localStorage can fail (private browsing, quota) — in-memory state still works for this session.
    }
  }, [selected]);

  function toggle(id: SentimentSourceId) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return { selected, toggle };
}
