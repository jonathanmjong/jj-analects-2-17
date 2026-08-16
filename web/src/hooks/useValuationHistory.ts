import { useQuery } from "@tanstack/react-query";
import type { Firestore } from "firebase/firestore";
import type { FloatAnchor, MarketDataPoint, ValuationHistoryEntry } from "@proverbs/shared";
import { loadFirestore } from "../lib/firebase";

export interface ValuationHistoryData {
  entries: ValuationHistoryEntry[];
  /**
   * Dates where this company's public float and its market cap were both
   * observed. Empty for most companies: the daily marketData series only
   * started accumulating in mid-2026, while a fiscal year's float is measured
   * at that year's Q2 — so only the newest fiscal years can ever be anchored,
   * and only once the market-cap series is old enough to overlap them.
   */
  anchors: FloatAnchor[];
}

/** Fiscal years, newest first, for which an anchor lookup is even worth a query. */
const ANCHOR_CANDIDATE_LIMIT = 2;

/** Days either side of the float measurement date to search the daily market-cap series. Kept tight: further out the ratio would encode the share price move between the two dates rather than the non-affiliate share of the register. */
const ANCHOR_SEARCH_DAYS = 10;

function shiftDate(isoDate: string, days: number): string {
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) return isoDate;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

async function findAnchor(db: Firestore, symbol: string, entry: ValuationHistoryEntry): Promise<FloatAnchor | null> {
  const { collection, getDocs, orderBy, query, where } = await import("../lib/firestore");
  const snap = await getDocs(
    query(
      collection(db, "companies", symbol, "marketData"),
      where("date", ">=", shiftDate(entry.floatAsOf, -ANCHOR_SEARCH_DAYS)),
      where("date", "<=", shiftDate(entry.floatAsOf, ANCHOR_SEARCH_DAYS)),
      orderBy("date", "asc"),
    ),
  );

  const target = Date.parse(entry.floatAsOf);
  let closest: MarketDataPoint | null = null;
  for (const doc of snap.docs) {
    const point = doc.data() as MarketDataPoint;
    if (typeof point.marketCap !== "number" || !Number.isFinite(point.marketCap) || point.marketCap <= 0) continue;
    if (closest === null || Math.abs(Date.parse(point.date) - target) < Math.abs(Date.parse(closest.date) - target)) {
      closest = point;
    }
  }
  if (closest === null) return null;

  return {
    fiscalYear: entry.fiscalYear,
    floatAsOf: entry.floatAsOf,
    marketCapAsOf: closest.date,
    marketCap: closest.marketCap,
    publicFloat: entry.publicFloat,
  };
}

export function useValuationHistory(ticker: string | undefined) {
  return useQuery({
    queryKey: ["valuation-history", ticker],
    enabled: !!ticker,
    queryFn: async (): Promise<ValuationHistoryData> => {
      if (!ticker) return { entries: [], anchors: [] };
      const symbol = ticker.toUpperCase();

      const [{ collection, getDocs, orderBy, query }, db] = await Promise.all([
        import("../lib/firestore"),
        loadFirestore(),
      ]);

      const snap = await getDocs(
        query(collection(db, "companies", symbol, "valuationHistory"), orderBy("fiscalYear", "asc")),
      );
      const entries = snap.docs
        .map((d) => d.data() as ValuationHistoryEntry)
        .filter((e) => typeof e.fiscalYear === "number" && typeof e.publicFloat === "number" && !!e.floatAsOf);

      const candidates = [...entries].sort((a, b) => b.fiscalYear - a.fiscalYear).slice(0, ANCHOR_CANDIDATE_LIMIT);
      const anchors = (await Promise.all(candidates.map((entry) => findAnchor(db, symbol, entry)))).filter(
        (anchor): anchor is FloatAnchor => anchor !== null,
      );

      return { entries, anchors };
    },
    // Annual filings and a fixed historical market-cap series — nothing here
    // changes within a session.
    staleTime: 12 * 60 * 60 * 1000,
  });
}
