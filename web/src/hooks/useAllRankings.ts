import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import type { RankingResult } from "@proverbs/shared";
import { db } from "../lib/firebase";

/** Bulk fetch of rankings/latest/companies — used where per-metric category breakdown (not just overall score) is needed for list-level filtering. */
export function useAllRankings() {
  return useQuery({
    queryKey: ["all-rankings"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "rankings", "latest", "companies"));
      const byTicker = new Map<string, RankingResult>();
      for (const doc of snap.docs) {
        byTicker.set(doc.id, doc.data() as RankingResult);
      }
      return byTicker;
    },
    staleTime: 5 * 60 * 1000,
  });
}
