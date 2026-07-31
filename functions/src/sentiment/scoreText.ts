import type { SentimentLabel } from "@proverbs/shared";
import { NEGATION_WORDS, NEGATIVE_WORDS, POSITIVE_WORDS } from "./lexicon.js";

const NEGATION_WINDOW = 3;

/**
 * Scores one piece of text (a headline) in [-1, 1] via lexicon word matching
 * with a short negation window ("not profitable" flips the "profitable"
 * match from positive to negative). Returns 0 for text with no matched
 * sentiment words — genuinely neutral/unscored, not "slightly negative."
 */
export function scoreText(text: string): { score: number; matchedPositive: number; matchedNegative: number } {
  const tokens = text.toLowerCase().match(/[a-z']+(?:-[a-z']+)?/g) ?? [];

  let positive = 0;
  let negative = 0;

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const isPositive = POSITIVE_WORDS.has(word);
    const isNegative = NEGATIVE_WORDS.has(word);
    if (!isPositive && !isNegative) continue;

    const windowStart = Math.max(0, i - NEGATION_WINDOW);
    const negated = tokens.slice(windowStart, i).some((w) => NEGATION_WORDS.has(w));

    const effectivelyPositive = negated ? isNegative : isPositive;
    if (effectivelyPositive) positive++;
    else negative++;
  }

  const total = positive + negative;
  const score = total === 0 ? 0 : (positive - negative) / total;
  return { score, matchedPositive: positive, matchedNegative: negative };
}

/** Maps a [-1, 1] score to the app's 0-100 display scale (50 = neutral), matching overallScore's convention. */
export function scoreToDisplayScale(score: number): number {
  return (score + 1) * 50;
}

export function labelForScore(score: number): SentimentLabel {
  if (score > 0.15) return "positive";
  if (score < -0.15) return "negative";
  return "neutral";
}
