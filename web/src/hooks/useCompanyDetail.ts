import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import type {
  BalanceSheet,
  CashFlowStatement,
  Company,
  IncomeStatement,
  MetricScore,
  PriceHistoryPoint,
  RankingResult,
  SentimentHeadline,
} from "@proverbs/shared";
import { db } from "../lib/firebase";

export interface CompanyDetail {
  company: Company;
  ranking: RankingResult | null;
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  metricScoresByPeriod: Array<{ periodKey: string; scores: Record<string, MetricScore> }>;
  historicalRankings: Array<{ date: string; overallScore: number | null; overallRank: number | null }>;
  priceHistory: PriceHistoryPoint[];
  sentimentHeadlines: SentimentHeadline[];
}

export function useCompanyDetail(ticker: string | undefined) {
  return useQuery({
    queryKey: ["company-detail", ticker],
    enabled: !!ticker,
    queryFn: async (): Promise<CompanyDetail | null> => {
      if (!ticker) return null;
      const symbol = ticker.toUpperCase();

      const [
        companySnap,
        rankingSnap,
        incomeSnap,
        balanceSnap,
        cashFlowSnap,
        metricScoresSnap,
        histRankSnap,
        priceHistorySnap,
        sentimentSnap,
      ] = await Promise.all([
        getDoc(doc(db, "companies", symbol)),
        getDoc(doc(db, "rankings", "latest", "companies", symbol)),
        getDocs(query(collection(db, "companies", symbol, "incomeStatements"), orderBy("fiscalYear", "desc"))),
        getDocs(query(collection(db, "companies", symbol, "balanceSheets"), orderBy("fiscalYear", "desc"))),
        getDocs(query(collection(db, "companies", symbol, "cashFlowStatements"), orderBy("fiscalYear", "desc"))),
        getDocs(query(collection(db, "companies", symbol, "metricScores"), orderBy("periodKey", "desc"))),
        getDocs(query(collection(db, "historicalRankings", symbol, "snapshots"), orderBy("date", "asc"))),
        getDoc(doc(db, "companies", symbol, "priceHistory", "daily")),
        getDoc(doc(db, "companies", symbol, "sentiment", "latest")),
      ]);

      if (!companySnap.exists()) return null;

      const priceHistoryData = priceHistorySnap.exists()
        ? (priceHistorySnap.data() as { points: PriceHistoryPoint[] })
        : null;
      const sentimentData = sentimentSnap.exists() ? (sentimentSnap.data() as { headlines: SentimentHeadline[] }) : null;

      return {
        company: companySnap.data() as Company,
        ranking: rankingSnap.exists() ? (rankingSnap.data() as RankingResult) : null,
        income: incomeSnap.docs.map((d) => d.data() as IncomeStatement),
        balance: balanceSnap.docs.map((d) => d.data() as BalanceSheet),
        cashFlow: cashFlowSnap.docs.map((d) => d.data() as CashFlowStatement),
        metricScoresByPeriod: metricScoresSnap.docs.map((d) => d.data() as { periodKey: string; scores: Record<string, MetricScore> }),
        historicalRankings: histRankSnap.docs.map((d) => d.data() as { date: string; overallScore: number | null; overallRank: number | null }),
        priceHistory: [...(priceHistoryData?.points ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
        sentimentHeadlines: sentimentData?.headlines ?? [],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
