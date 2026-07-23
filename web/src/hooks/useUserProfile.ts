import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { UserProfile } from "@proverbs/shared";
import { db } from "../lib/firebase";
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
    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return { profile, loading, watchlist: profile?.watchlist ?? [] };
}
