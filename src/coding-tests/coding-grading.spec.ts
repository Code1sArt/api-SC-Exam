import { calculateCodingScoreParts, clampScore } from './coding-grading';

describe('coding grading score', () => {
  it('reserves 70% for test cases and 30% for AI code review', () => {
    const parts = calculateCodingScoreParts(10, 2, 4);

    expect(parts.testCaseScore).toBeCloseTo(3.5);
    expect(parts.testCaseMaxScore).toBeCloseTo(7);
    expect(parts.aiReviewMaxScore).toBeCloseTo(3);
  });

  it('leaves AI review credit available when exact-output tests fail', () => {
    const parts = calculateCodingScoreParts(20, 0, 3);

    expect(parts.testCaseScore).toBe(0);
    expect(parts.aiReviewMaxScore).toBeCloseTo(6);
  });

  it('clamps invalid AI scores to its allocated score range', () => {
    expect(clampScore(8, 3)).toBe(3);
    expect(clampScore(-1, 3)).toBe(0);
    expect(clampScore('invalid', 3)).toBe(0);
  });
});
