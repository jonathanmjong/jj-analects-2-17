import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

export interface ForensicBaseRate {
  tripped: number;
  /** Percentage of covered companies tripping this check, 0-100, one decimal. */
  pct: number;
}

export interface ForensicBaseRates {
  asOf: string;
  totalCompanies: number;
  rates: Record<string, ForensicBaseRate>;
}

/**
 * Universe-wide trip rate per forensic check, written nightly by recomputeRankingsDaily.
 * Returns null when the doc doesn't exist yet (it appears only after the first nightly run
 * following deploy) — the panel then simply omits its base-rate captions rather than blocking.
 */
export function useForensicBaseRates() {
  return useQuery({
    queryKey: ["forensic-base-rates"],
    queryFn: async (): Promise<ForensicBaseRates | null> => {
      const snap = await getDoc(doc(db, "system", "forensicBaseRates"));
      return snap.exists() ? (snap.data() as ForensicBaseRates) : null;
    },
    // Recomputed once a night and identical for every company page, so it's worth holding
    // for the whole session rather than refetching per company.
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
  });
}
