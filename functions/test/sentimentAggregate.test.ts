import { describe, expect, it } from "vitest";
import { aggregateSentiment, type SentimentSourceBreakdown } from "@proverbs/shared";

const positive: SentimentSourceBreakdown = { score: 90, articleCount: 4, positiveCount: 4, negativeCount: 0 };
const negative: SentimentSourceBreakdown = { score: 10, articleCount: 1, positiveCount: 0, negativeCount: 1 };
const neutral: SentimentSourceBreakdown = { score: 50, articleCount: 2, positiveCount: 0, negativeCount: 0 };

describe("aggregateSentiment", () => {
  it("returns null when no selected source has any data", () => {
    expect(aggregateSentiment({ yahoo: positive }, ["google_news"])).toBeNull();
    expect(aggregateSentiment({}, ["yahoo"])).toBeNull();
  });

  it("returns the single source unchanged when only one is selected", () => {
    const result = aggregateSentiment({ yahoo: positive, gdelt: negative }, ["yahoo"]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(90);
    expect(result!.articleCount).toBe(4);
  });

  it("weights by article count, not a plain average of source scores", () => {
    // 4 articles at 90 + 1 article at 10 should pull much closer to 90 than a naive (90+10)/2=50 average.
    const result = aggregateSentiment({ yahoo: positive, gdelt: negative }, ["yahoo", "gdelt"]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(70);
    expect(result!.articleCount).toBe(5);
  });

  it("sums article/positive/negative counts across selected sources", () => {
    const result = aggregateSentiment({ yahoo: positive, gdelt: negative, google_news: neutral }, ["yahoo", "gdelt", "google_news"]);
    expect(result!.articleCount).toBe(7);
    expect(result!.positiveCount).toBe(4);
    expect(result!.negativeCount).toBe(1);
  });

  it("ignores sources not in bySource even if selected", () => {
    const result = aggregateSentiment({ yahoo: positive }, ["yahoo", "reddit", "stocktwits"]);
    expect(result).not.toBeNull();
    expect(result!.articleCount).toBe(4);
  });

  it("labels a strongly positive aggregate as positive", () => {
    const result = aggregateSentiment({ yahoo: positive }, ["yahoo"]);
    expect(result!.label).toBe("positive");
  });

  it("labels a strongly negative aggregate as negative", () => {
    const result = aggregateSentiment({ yahoo: negative }, ["yahoo"]);
    expect(result!.label).toBe("negative");
  });
});
