import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const store = new Map<string, unknown>();

/**
 * Like useState, but the value survives unmount/remount within the same tab
 * session (e.g. navigating away from the Rankings page and back) by keeping
 * a module-scope copy alongside the component state. Not persisted across a
 * hard page reload — that's a stronger guarantee than "go back to the home
 * page and your filters are still there," and would need serialization
 * (Set/Map-typed filter state here doesn't survive JSON round-tripping).
 *
 * Pass `key: null` to opt out of persistence entirely (behaves like plain
 * useState, no entry ever written to the shared store) — used by callers
 * that only sometimes want persistence, so they don't leak an entry per
 * mount when they don't.
 */
export function usePageState<T>(key: string | null, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (key !== null && store.has(key)) return store.get(key) as T;
    return initial instanceof Function ? initial() : initial;
  });

  useEffect(() => {
    if (key !== null) store.set(key, state);
  }, [key, state]);

  return [state, setState];
}

/**
 * Wipes all persisted page state. Must be called on sign-out (and on
 * switching to a different account in the same tab) — otherwise the next
 * user to sign in on this tab would see the previous user's filters,
 * weights, and sort order. See web/src/context/AuthProvider.tsx.
 */
export function clearPageState(): void {
  store.clear();
}
