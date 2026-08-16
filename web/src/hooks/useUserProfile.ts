import { useEffect, useState } from "react";
import type { UserProfile } from "@proverbs/shared";
import { loadFirestore } from "../lib/firebase";
import { useAuth } from "../context/AuthProvider";

/** Live-syncing subscription to the signed-in user's Firestore profile (watchlist, etc.) — updates immediately when toggled from anywhere in the app. */
export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    // The listener can only be attached once the Firestore chunk has loaded, so
    // unsubscribe has to survive an unmount that happens before then.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const [{ doc, onSnapshot }, db] = await Promise.all([import("../lib/firestore"), loadFirestore()]);
      if (cancelled) return;
      unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
        setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user]);

  return { profile, loading, watchlist: profile?.watchlist ?? [] };
}
