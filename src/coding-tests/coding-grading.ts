export const CODING_TEST_CASE_WEIGHT = 0.7;
export const CODING_AI_REVIEW_WEIGHT = 0.3;

export function calculateCodingScoreParts(
  maxScore: number,
  passedTestCases: number,
  totalTestCases: number,
) {
  const safeMaxScore = Math.max(0, maxScore);
  const safeTotal = Math.max(0, totalTestCases);
  const safePassed = Math.min(Math.max(0, passedTestCases), safeTotal);
  const testCaseMaxScore = safeMaxScore * CODING_TEST_CASE_WEIGHT;
  const aiReviewMaxScore = safeMaxScore * CODING_AI_REVIEW_WEIGHT;

  return {
    testCaseScore: safeTotal ? testCaseMaxScore * (safePassed / safeTotal) : 0,
    testCaseMaxScore,
    aiReviewMaxScore,
  };
}

export function clampScore(score: unknown, maxScore: number) {
  const parsed = Number(score);
  return Math.max(0, Math.min(maxScore, Number.isFinite(parsed) ? parsed : 0));
}
