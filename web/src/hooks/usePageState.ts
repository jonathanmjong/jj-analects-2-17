import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const store = new Map<string, unknown>();

/**
 * Like useState, but the value survives unmount/remount within the same tab
 * session (e.g. navigating away from the Rankings page and back) by keeping
 * a module-scope copy alongside the component state. Not persisted across a
 * hard page reload — that's a stronger guarantee than "go back to the home
 * page and your filters are still there," and would need serialization
 * (Set/Map-typed filter state here doesn't survive JSON round-tripping).
 */
export function usePageState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T;
    return initial instanceof Function ? initial() : initial;
  });

  useEffect(() => {
    store.set(key, state);
  }, [key, state]);

  return [state, setState];
}

export function hasPageState(key: string): boolean {
  return store.has(key);
}
