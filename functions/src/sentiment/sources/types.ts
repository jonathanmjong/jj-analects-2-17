export interface RawHeadline {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
}

export interface SentimentSource {
  fetchHeadlines(ticker: string, companyName: string | null): Promise<RawHeadline[] | null>;
}
