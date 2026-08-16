import { loadFirestore } from "../lib/firebase";
import { useAuth } from "../context/AuthProvider";

export function useWatchlist() {
  const { user } = useAuth();

  async function addToWatchlist(ticker: string) {
    if (!user) return;
    const [{ doc, updateDoc, arrayUnion }, db] = await Promise.all([import("../lib/firestore"), loadFirestore()]);
    await updateDoc(doc(db, "users", user.uid), { watchlist: arrayUnion(ticker.toUpperCase()) });
  }

  async function removeFromWatchlist(ticker: string) {
    if (!user) return;
    const [{ doc, updateDoc, arrayRemove }, db] = await Promise.all([import("../lib/firestore"), loadFirestore()]);
    await updateDoc(doc(db, "users", user.uid), { watchlist: arrayRemove(ticker.toUpperCase()) });
  }

  return { addToWatchlist, removeFromWatchlist };
}
