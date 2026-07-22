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
    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        await ensureUserDocument(nextUser);
        const token = await nextUser.getIdTokenResult();
        setSubscribed(token.claims.subscribed === true);
      } else {
        setSubscribed(false);
      }
      setLoading(false);
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
