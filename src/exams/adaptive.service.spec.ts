import { Difficulty } from '@prisma/client';
import { AdaptiveService } from './adaptive.service';

describe('AdaptiveService', () => {
  const service = new AdaptiveService();

  it('raises difficulty after three consecutive correct answers', () => {
    const result = service.nextState(
      {
        correctStreak: 2,
        incorrectStreak: 0,
        currentDifficulty: Difficulty.MEDIUM,
      },
      true,
      true,
    );
    expect(result).toEqual({
      correctStreak: 0,
      incorrectStreak: 0,
      currentDifficulty: Difficulty.HARD,
    });
  });

  it('lowers difficulty after two consecutive incorrect answers', () => {
    const result = service.nextState(
      {
        correctStreak: 0,
        incorrectStreak: 1,
        currentDifficulty: Difficulty.MEDIUM,
      },
      false,
      true,
    );
    expect(result.currentDifficulty).toBe(Difficulty.EASY);
    expect(result.incorrectStreak).toBe(0);
  });

  it('does not move beyond the difficulty boundaries', () => {
    expect(
      service.nextState(
        {
          correctStreak: 2,
          incorrectStreak: 0,
          currentDifficulty: Difficulty.VERY_HARD,
        },
        true,
        true,
      ).currentDifficulty,
    ).toBe(Difficulty.VERY_HARD);
  });
});
