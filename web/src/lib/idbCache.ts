/**
 * IndexedDB-backed caches so reloads skip the expensive fetches: the ~2MB
 * ranking-universe download and the Firestore reads behind TanStack Query.
 * Everything here is best-effort — IndexedDB being unavailable (private
 * windows, storage pressure) degrades to the network path, never to an error.
 *
 * SECURITY: everything stored here is Storage-rules/Firestore-rules-gated
 * content. It is keyed by content, not by uid, so it MUST be wiped on any
 * identity change — see clearIdbCaches() and AuthProvider.
 */

const DB_NAME = "analects-cache";
const STORE = "kv";

/**
 * Bump to invalidate every persisted cache after a breaking shape change.
 * v2: forces a clean slate past anything written by the un-timed-out version
 * below, which could leave a client stuck waiting on IndexedDB.
 */
export const CACHE_VERSION = "v2";

/**
 * Every IndexedDB call is wrapped in this. `indexedDB.open()` can hang without
 * ever firing success/error/blocked — another tab mid-upgrade, private-browsing
 * modes, storage pressure — and a hung cache read must degrade to the network,
 * never stall the caller. Learned the hard way: without this, a blocked open
 * left the app on a permanent loading state because auth and query restoration
 * were both waiting on it.
 */
const IDB_TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, IDB_TIMEOUT_MS);
    work
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    null,
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await withTimeout(
    new Promise<T | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    null,
  );
  db.close();
  return value;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await withTimeout(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
  db.close();
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await withTimeout(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
  db.close();
}

/** Wipes every IDB-persisted cache. Must run on sign-out/identity change. */
export async function clearIdbCaches(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await withTimeout(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
  db.close();
}

const OWNER_KEY = "cache-owner-uid";

/**
 * Persistent caches survive reloads, so "who was signed in when this tab last
 * ran" is not enough — the IDB contents belong to whoever used this browser
 * profile last, which the current tab has never seen. Stamp the store with
 * the owning uid and wipe on mismatch: same user reloading keeps the fast
 * path, anyone else (including signed-out) gets a clean store. Returns
 * whether a wipe happened so callers can also drop in-memory copies.
 */
export async function ensureCacheOwner(uid: string | null): Promise<boolean> {
  const owner = await idbGet<string | null>(OWNER_KEY);
  if ((owner ?? null) === uid) return false;
  await clearIdbCaches();
  await idbSet(OWNER_KEY, uid);
  return true;
}

/**
 * The ranking-universe export is rewritten once a day by recomputeRankingsDaily
 * (23:00 America/New_York — 03:00–03:15 UTC in summer, 04:00–04:15 in winter).
 * A cached copy is fresh until the first 04:30 UTC boundary after it was
 * cached: 04:30 is comfortably after the job finishes in either DST regime,
 * and using the later of the two avoids marking a copy stale before its
 * replacement exists (which would re-cache the same data and then treat THAT
 * copy as a day fresher than it is).
 */
export const UNIVERSE_EXPORT_BOUNDARY_UTC_HOUR = 4.5;

export function isUniverseCacheFresh(cachedAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(cachedAtMs) || cachedAtMs > nowMs) return false;
  const boundary = new Date(cachedAtMs);
  boundary.setUTCHours(4, 30, 0, 0);
  if (boundary.getTime() <= cachedAtMs) boundary.setUTCDate(boundary.getUTCDate() + 1);
  return nowMs < boundary.getTime();
}
