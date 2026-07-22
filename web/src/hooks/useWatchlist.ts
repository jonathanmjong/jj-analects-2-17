import { doc, updateDoc, arrayRemove, arrayUnion } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthProvider";

export function useWatchlist() {
  const { user } = useAuth();

  async function addToWatchlist(ticker: string) {
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid), { watchlist: arrayUnion(ticker.toUpperCase()) });
  }

  async function removeFromWatchlist(ticker: string) {
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid), { watchlist: arrayRemove(ticker.toUpperCase()) });
  }

  return { addToWatchlist, removeFromWatchlist };
}
