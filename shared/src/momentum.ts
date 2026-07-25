/** One trailing daily (or near-daily) closing price, used only to derive momentum — not a full OHLC history. */
export interface PriceHistoryPoint {
  date: string;
  close: number;
}

/** Firestore doc: companies/{ticker}/priceHistory/daily — compact trailing series (~2 years) used to compute momentum. */
export interface PriceHistorySeries {
  points: PriceHistoryPoint[];
  updatedAt: string;
}

/**
 * Precomputed momentum figures, denormalized onto companies/{ticker}.latest
 * so the ranking pipeline can treat momentum like any other current-snapshot
 * input (the same way it already does for marketCap/enterpriseValue) without
 * needing per-fiscal-year data.
 */
export interface MomentumSnapshot {
  /** 12-month trailing return excluding the most recent month (Jegadeesh-Titman "12-1" momentum) — the standard academic momentum factor. */
  return12m1m: number | null;
  /** Trailing 3-month cumulative return divided by trailing 3-month daily-return volatility — rewards steady climbers over volatile spikes. */
  riskAdjusted3m: number | null;
  /** Same as riskAdjusted3m over a 6-month window. */
  riskAdjusted6m: number | null;
  asOf: string;
}
