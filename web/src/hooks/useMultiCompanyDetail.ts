import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import type { Company, RankingResult } from "@proverbs/shared";
import { db } from "../lib/firebase";

export interface CompareRow {
  ticker: string;
  company: Company | null;
  ranking: RankingResult | null;
}

export function useMultiCompanyDetail(tickers: string[]) {
  return useQuery({
    queryKey: ["compare-companies", tickers],
    enabled: tickers.length > 0,
    queryFn: async (): Promise<CompareRow[]> => {
      return Promise.all(
        tickers.map(async (ticker) => {
          const symbol = ticker.toUpperCase();
          const [companySnap, rankingSnap] = await Promise.all([
            getDoc(doc(db, "companies", symbol)),
            getDoc(doc(db, "rankings", "latest", "companies", symbol)),
          ]);
          return {
            ticker: symbol,
            company: companySnap.exists() ? (companySnap.data() as Company) : null,
            ranking: rankingSnap.exists() ? (rankingSnap.data() as RankingResult) : null,
          };
        }),
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}
