import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { signInWithPopup, signOut as firebaseSignOut, onIdTokenChanged, type User } from "firebase/auth";
import { auth, googleProvider, loadFirestore } from "../lib/firebase";
import { clearStoredReferralCode, getStoredReferralCode } from "../lib/referral";
import { clearPageState } from "../hooks/usePageState";
import { clearRankingUniverseCache } from "../lib/clientRankingEngine";
import { ensureCacheOwner } from "../lib/idbCache";
import { queryClient } from "../lib/queryClient";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  subscribed: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSubscriptionClaim: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Upper bound on how long auth resolution will wait for the user document.
 * Matches idbCache's IDB_TIMEOUT_MS and exists for the same reason: this step
 * is best-effort bookkeeping, and nothing best-effort may gate the app's
 * loading state. Expiring the wait does NOT cancel the write — the promise
 * keeps running, we just stop blocking the sign-in transition on it.
 */
const USER_DOC_TIMEOUT_MS = 3000;

/**
 * Never rejects and never blocks longer than USER_DOC_TIMEOUT_MS. Firestore is
 * dynamically imported here (rather than statically in lib/firebase) so an
 * anonymous visitor on the landing page never downloads the Firestore SDK; a
 * failed or slow chunk fetch must therefore degrade to "no user doc written
 * yet", not to a stuck sign-in.
 */
async function ensureUserDocumentBestEffort(user: User): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, USER_DOC_TIMEOUT_MS);
    ensureUserDocument(user)
      .catch((err) => {
        console.error("Failed to ensure user document", err);
      })
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

async function ensureUserDocument(user: User): Promise<void> {
  const [{ doc, getDoc, setDoc, serverTimestamp }, db] = await Promise.all([
    import("../lib/firestore"),
    loadFirestore(),
  ]);
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const referredBy = getStoredReferralCode();
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: "none",
      trialEnd: null,
      currentPeriodEnd: null,
      watchlist: [],
      // Self-referral (e.g. a stale ?ref=<own-uid> from testing your own link) doesn't count.
      referredBy: referredBy && referredBy !== user.uid ? referredBy : null,
      referralCreditGranted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    clearStoredReferralCode();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Tracks the signed-in uid across callback invocations so we can tell a
    // genuine sign-in/sign-out apart from a routine background token refresh
    // (onIdTokenChanged fires for both, roughly hourly for an active session).
    let previousUid: string | null = null;

    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      const identityChanged = (nextUser?.uid ?? null) !== previousUid;
      previousUid = nextUser?.uid ?? null;

      // Every cross-session client-side cache is keyed by content, not by uid — sign-out (or
      // switching to a different account in the same tab) must wipe them, or the next identity
      // on this tab would silently see the previous user's cached filters/weights/financial data.
      if (identityChanged) {
        clearPageState();
      }
      // The persistent (IndexedDB) caches are wiped on OWNERSHIP mismatch, not
      // on this tab's identity transitions: identityChanged is also true on
      // every initial auth resolution (previousUid starts null), and wiping
      // there would throw away the same user's persisted cache on every
      // reload — while NOT wiping on first resolution would hand this user
      // whatever the previous owner of this browser profile left behind.
      //
      // Deliberately NOT awaited. Auth resolution must never depend on the
      // cache: awaiting this once left the whole app stuck on its loading
      // state when IndexedDB was slow to open. The wipe still runs before any
      // rendered query can read stale data, because clearing is synchronous
      // from React's perspective once it resolves, and a cross-identity read
      // is already gated by Firestore/Storage rules on the server.
      void ensureCacheOwner(nextUser?.uid ?? null)
        .then((cacheWiped) => {
          if (cacheWiped) {
            clearRankingUniverseCache();
            queryClient.clear();
          }
        })
        .catch(() => undefined);

      // Only show the loading spinner for an actual sign-in/sign-out transition.
      // Setting user and subscribed together (instead of user first, subscribed
      // after an await) avoids RequireSubscription briefly seeing a signed-in
      // user with the *previous* (default-false) subscribed value and bouncing
      // an already-subscribed user to /billing right after they sign in.
      if (identityChanged) setLoading(true);
      try {
        if (nextUser) {
          await ensureUserDocumentBestEffort(nextUser);
          const token = await nextUser.getIdTokenResult();
          setUser(nextUser);
          setSubscribed(token.claims.subscribed === true);
        } else {
          setUser(null);
          setSubscribed(false);
        }
      } catch (err) {
        console.error("Failed to resolve auth/subscription state", err);
        setUser(nextUser);
        setSubscribed(false);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle() {
    await signInWithPopup(auth, googleProvider);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  async function refreshSubscriptionClaim() {
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdTokenResult(true);
    setSubscribed(token.claims.subscribed === true);
  }

  return (
    <AuthContext.Provider value={{ user, loading, subscribed, signInWithGoogle, signOut, refreshSubscriptionClaim }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
