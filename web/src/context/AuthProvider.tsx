import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { signInWithPopup, signOut as firebaseSignOut, onIdTokenChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  subscribed: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSubscriptionClaim: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureUserDocument(user: User): Promise<void> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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

      // Only show the loading spinner for an actual sign-in/sign-out transition.
      // Setting user and subscribed together (instead of user first, subscribed
      // after an await) avoids RequireSubscription briefly seeing a signed-in
      // user with the *previous* (default-false) subscribed value and bouncing
      // an already-subscribed user to /billing right after they sign in.
      if (identityChanged) setLoading(true);
      try {
        if (nextUser) {
          await ensureUserDocument(nextUser);
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
