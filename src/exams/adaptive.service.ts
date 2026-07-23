import { Injectable } from '@nestjs/common';
import { Difficulty } from '@prisma/client';

export const DIFFICULTY_LEVELS = [
  Difficulty.VERY_EASY,
  Difficulty.EASY,
  Difficulty.MEDIUM,
  Difficulty.HARD,
  Difficulty.VERY_HARD,
];

@Injectable()
export class AdaptiveService {
  nextState(
    attempt: {
      correctStreak: number;
      incorrectStreak: number;
      currentDifficulty: Difficulty;
    },
    isCorrect: boolean,
    isAdaptive: boolean,
  ) {
    let correctStreak = isCorrect ? attempt.correctStreak + 1 : 0;
    let incorrectStreak = isCorrect ? 0 : attempt.incorrectStreak + 1;
    let currentDifficulty = attempt.currentDifficulty;
    if (isAdaptive && correctStreak >= 3) {
      currentDifficulty = this.shift(currentDifficulty, 1);
      correctStreak = 0;
    } else if (isAdaptive && incorrectStreak >= 2) {
      currentDifficulty = this.shift(currentDifficulty, -1);
      incorrectStreak = 0;
    }
    return { correctStreak, incorrectStreak, currentDifficulty };
  }

  distance(left: Difficulty, right: Difficulty) {
    return Math.abs(
      DIFFICULTY_LEVELS.indexOf(left) - DIFFICULTY_LEVELS.indexOf(right),
    );
  }

  private shift(current: Difficulty, delta: number) {
    const index = DIFFICULTY_LEVELS.indexOf(current);
    return DIFFICULTY_LEVELS[
      Math.max(0, Math.min(DIFFICULTY_LEVELS.length - 1, index + delta))
    ];
  }
}
