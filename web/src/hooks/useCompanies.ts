import { useQuery } from "@tanstack/react-query";
import type { QueryConstraint } from "firebase/firestore";
import type { Company, Sector } from "@proverbs/shared";
import { loadFirestore } from "../lib/firebase";

export interface CompanyListFilters {
  sector?: Sector;
  isSp500?: boolean;
  marketCapTier?: "mid" | "large";
  limitTo?: number;
}

export function useCompaniesList(filters: CompanyListFilters = {}) {
  return useQuery({
    queryKey: ["companies", filters],
    queryFn: async () => {
      const [{ collection, getDocs, limit: fbLimit, orderBy, query, where }, db] = await Promise.all([
        import("../lib/firestore"),
        loadFirestore(),
      ]);
      const constraints: QueryConstraint[] = [];
      if (filters.sector) constraints.push(where("sector", "==", filters.sector));
      if (filters.isSp500 !== undefined) constraints.push(where("isSp500", "==", filters.isSp500));
      if (filters.marketCapTier) constraints.push(where("marketCapTier", "==", filters.marketCapTier));
      constraints.push(orderBy("latest.overallScore", "desc"));
      constraints.push(fbLimit(filters.limitTo ?? 5000));

      const snap = await getDocs(query(collection(db, "companies"), ...constraints));
      return snap.docs.map((d) => d.data() as Company);
    },
    staleTime: 5 * 60 * 1000,
  });
}
