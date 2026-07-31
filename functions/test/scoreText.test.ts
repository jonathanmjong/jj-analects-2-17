import { describe, expect, it } from "vitest";
import { labelForScore, scoreText, scoreToDisplayScale } from "../src/sentiment/scoreText.js";

describe("scoreText", () => {
  it("scores a purely positive headline above zero", () => {
    const { score } = scoreText("Company beats earnings, stock surges to record high");
    expect(score).toBeGreaterThan(0);
  });

  it("scores a purely negative headline below zero", () => {
    const { score } = scoreText("Company misses earnings, shares plunge amid fraud investigation");
    expect(score).toBeLessThan(0);
  });

  it("returns exactly 0 for text with no sentiment words", () => {
    const { score, matchedPositive, matchedNegative } = scoreText("Company announces quarterly board meeting date");
    expect(score).toBe(0);
    expect(matchedPositive).toBe(0);
    expect(matchedNegative).toBe(0);
  });

  it("flips polarity within the negation window", () => {
    const negated = scoreText("Company is not profitable this quarter");
    expect(negated.score).toBeLessThan(0);
    const plain = scoreText("Company is profitable this quarter");
    expect(plain.score).toBeGreaterThan(0);
  });

  it("mixed positive and negative words partially cancel", () => {
    const { score } = scoreText("Strong revenue growth offset by rising costs and weak guidance");
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("scoreToDisplayScale", () => {
  it("maps -1 to 0, 0 to 50, 1 to 100", () => {
    expect(scoreToDisplayScale(-1)).toBe(0);
    expect(scoreToDisplayScale(0)).toBe(50);
    expect(scoreToDisplayScale(1)).toBe(100);
  });
});

describe("labelForScore", () => {
  it("classifies clearly positive/negative/neutral scores", () => {
    expect(labelForScore(0.5)).toBe("positive");
    expect(labelForScore(-0.5)).toBe("negative");
    expect(labelForScore(0)).toBe("neutral");
    expect(labelForScore(0.1)).toBe("neutral");
  });
});
