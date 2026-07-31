import { YahooFinanceProvider } from "../../providers/YahooFinanceProvider.js";
import type { RawHeadline, SentimentSource } from "./types.js";

/** Thin adapter over YahooFinanceProvider.getNews so it fits the same SentimentSource shape as the other sources — companyName isn't needed, Yahoo's search endpoint is already ticker-scoped. */
export class YahooNewsSource implements SentimentSource {
  private readonly yahoo = new YahooFinanceProvider();

  async fetchHeadlines(ticker: string): Promise<RawHeadline[] | null> {
    return this.yahoo.getNews(ticker);
  }
}
