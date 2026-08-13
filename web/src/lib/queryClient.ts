import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { CACHE_VERSION, idbDelete, idbGet, idbSet } from "./idbCache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Queries must outlive the tab for persistence to matter; staleTime in
      // each hook still governs when a restored query refetches in background.
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
});

const QUERY_CACHE_KEY = "tanstack-query-cache";

/**
 * Firestore-backed queries safe to restore instantly on reload — reference
 * data and per-company detail. Deliberately excluded: anything user-scoped
 * (watchlist lives inside `users/{uid}` docs) so a persisted cache can never
 * show one user another user's account data even within the wipe-on-identity-
 * change window.
 */
const PERSISTED_QUERY_KEYS = new Set([
  "companies",
  "company-detail",
  "compare-companies",
  "metric-definitions",
  "forensic-base-rates",
  "all-rankings",
]);

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: createAsyncStoragePersister({
    storage: {
      getItem: (key) => idbGet<string>(key),
      setItem: (key, value) => idbSet(key, value),
      removeItem: (key) => idbDelete(key),
    },
    key: QUERY_CACHE_KEY,
    throttleTime: 2_000,
  }),
  maxAge: 24 * 60 * 60 * 1000,
  buster: CACHE_VERSION,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && PERSISTED_QUERY_KEYS.has(String(query.queryKey[0])),
  },
};
