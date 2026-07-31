import { describe, expect, it } from "vitest";
import type { SentimentHeadline } from "@proverbs/shared";
import { summarizeSource } from "../src/sentiment/ingestSentiment.js";

function headline(score: number): SentimentHeadline {
  return { title: "t", publisher: "p", url: `u${Math.random()}`, publishedAt: "2026-01-01T00:00:00Z", source: "yahoo", score };
}

describe("summarizeSource", () => {
  it("maps a uniformly positive raw score (0.5) to 75 on the display scale, not a tiny near-zero value", () => {
    // Regression test: production data showed MSFT with score=0.55 labeled "negative" — traced to
    // this function treating headline.score (already raw [-1,1]) as if it needed unscaling from
    // display-scale first, corrupting the average into a number always near 0.
    const result = summarizeSource([headline(0.5), headline(0.5)]);
    expect(result.score).toBeCloseTo(75, 1);
  });

  it("maps a uniformly negative raw score (-0.5) to 25 on the display scale", () => {
    const result = summarizeSource([headline(-0.5), headline(-0.5)]);
    expect(result.score).toBeCloseTo(25, 1);
  });

  it("maps an all-neutral (0) raw score to exactly 50", () => {
    const result = summarizeSource([headline(0), headline(0)]);
    expect(result.score).toBeCloseTo(50, 1);
  });

  it("counts positive/negative headlines directly off raw score, not a rescaled one", () => {
    const result = summarizeSource([headline(0.5), headline(-0.5), headline(0)]);
    expect(result.positiveCount).toBe(1);
    expect(result.negativeCount).toBe(1);
    expect(result.articleCount).toBe(3);
  });
});
