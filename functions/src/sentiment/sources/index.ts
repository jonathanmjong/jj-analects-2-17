import type { SentimentSourceId } from "@proverbs/shared";
import type { SentimentSource } from "./types.js";
import { YahooNewsSource } from "./yahoo.js";
import { GoogleNewsSource } from "./googleNews.js";
import { GdeltSource } from "./gdelt.js";

/** Only the sources marked `available: true` in shared/src/sentiment.ts's SENTIMENT_SOURCES registry — see that file for why the others (Reddit, StockTwits, Finnhub, Alpha Vantage, X) aren't here yet. */
export const ACTIVE_SOURCES: Partial<Record<SentimentSourceId, SentimentSource>> = {
  yahoo: new YahooNewsSource(),
  google_news: new GoogleNewsSource(),
  gdelt: new GdeltSource(),
};
