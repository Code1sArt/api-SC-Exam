import { Difficulty, QuestionType } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptiveService } from './adaptive.service';
import { ExamsService } from './exams.service';

describe('ExamsService question selection', () => {
  const gradeAnswer = jest.fn();
  const service = new ExamsService(
    {} as PrismaService,
    { gradeAnswer } as unknown as AiService,
    new AdaptiveService(),
  );

  const item = (
    questionId: string,
    position: number,
    type: QuestionType,
    difficulty = Difficulty.MEDIUM,
  ) => ({
    id: `item-${questionId}`,
    examId: 'exam-1',
    questionId,
    position,
    score: 1,
    question: { id: questionId, type, difficulty },
  });

  const plan = (attempt: unknown) =>
    (
      service as unknown as {
        plannedItems(value: unknown): Array<{ questionId: string }>;
      }
    ).plannedItems(attempt);

  it('uses only the configured number from a larger adaptive pool', () => {
    const selected = plan({
      id: 'attempt-1',
      currentDifficulty: Difficulty.HARD,
      answers: [],
      exam: {
        isAdaptive: true,
        questionCount: 2,
        essayQuestionCount: null,
        items: [
          item('easy', 1, QuestionType.MULTIPLE_CHOICE, Difficulty.EASY),
          item('hard', 2, QuestionType.MULTIPLE_CHOICE, Difficulty.HARD),
          item(
            'very-hard',
            3,
            QuestionType.MULTIPLE_CHOICE,
            Difficulty.VERY_HARD,
          ),
        ],
      },
    });

    expect(selected.map((entry) => entry.questionId)).toEqual([
      'hard',
      'very-hard',
    ]);
  });

  it('keeps all essays when random essay count is null', () => {
    const selected = plan({
      id: 'attempt-1',
      currentDifficulty: Difficulty.MEDIUM,
      answers: [],
      exam: {
        isAdaptive: false,
        questionCount: 3,
        essayQuestionCount: null,
        items: [
          item('objective', 1, QuestionType.MULTIPLE_CHOICE),
          item('essay-1', 2, QuestionType.ESSAY),
          item('essay-2', 3, QuestionType.ESSAY),
        ],
      },
    });

    expect(selected.map((entry) => entry.questionId).sort()).toEqual([
      'essay-1',
      'essay-2',
      'objective',
    ]);
  });

  it('randomly assigns the configured essay count deterministically per attempt', () => {
    const attempt = {
      id: 'attempt-42',
      currentDifficulty: Difficulty.MEDIUM,
      answers: [],
      exam: {
        isAdaptive: false,
        questionCount: 2,
        essayQuestionCount: 1,
        items: [
          item('objective', 1, QuestionType.MULTIPLE_CHOICE),
          item('essay-1', 2, QuestionType.ESSAY),
          item('essay-2', 3, QuestionType.ESSAY),
          item('essay-3', 4, QuestionType.ESSAY),
        ],
      },
    };

    const first = plan(attempt).map((entry) => entry.questionId);
    const second = plan(attempt).map((entry) => entry.questionId);
    expect(first).toHaveLength(2);
    expect(first.filter((id) => id.startsWith('essay-'))).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('selects the exact configured count for each question type', () => {
    const selected = plan({
      id: 'attempt-ratios',
      currentDifficulty: Difficulty.MEDIUM,
      answers: [],
      exam: {
        isAdaptive: false,
        questionCount: 4,
        essayQuestionCount: null,
        questionTypeCounts: {
          MULTIPLE_CHOICE: 2,
          TRUE_FALSE: 1,
          SHORT_ANSWER: 0,
          ESSAY: 1,
          FILL_IN_BLANK: 0,
        },
        items: [
          item('mc-1', 1, QuestionType.MULTIPLE_CHOICE),
          item('mc-2', 2, QuestionType.MULTIPLE_CHOICE),
          item('mc-3', 3, QuestionType.MULTIPLE_CHOICE),
          item('tf-1', 4, QuestionType.TRUE_FALSE),
          item('tf-2', 5, QuestionType.TRUE_FALSE),
          item('essay-1', 6, QuestionType.ESSAY),
          item('essay-2', 7, QuestionType.ESSAY),
        ],
      },
    });
    const types = selected.map((entry) =>
      entry.questionId.startsWith('mc-')
        ? QuestionType.MULTIPLE_CHOICE
        : entry.questionId.startsWith('tf-')
          ? QuestionType.TRUE_FALSE
          : QuestionType.ESSAY,
    );

    expect(
      types.filter((type) => type === QuestionType.MULTIPLE_CHOICE),
    ).toHaveLength(2);
    expect(
      types.filter((type) => type === QuestionType.TRUE_FALSE),
    ).toHaveLength(1);
    expect(types.filter((type) => type === QuestionType.ESSAY)).toHaveLength(1);
  });

  it('randomizes objective question selection and order per attempt', () => {
    const base = {
      currentDifficulty: Difficulty.MEDIUM,
      answers: [],
      exam: {
        isAdaptive: false,
        questionCount: 3,
        essayQuestionCount: 0,
        items: [
          item('objective-1', 1, QuestionType.MULTIPLE_CHOICE),
          item('objective-2', 2, QuestionType.TRUE_FALSE),
          item('objective-3', 3, QuestionType.SHORT_ANSWER),
          item('objective-4', 4, QuestionType.FILL_IN_BLANK),
          item('objective-5', 5, QuestionType.MULTIPLE_CHOICE),
        ],
      },
    };

    const first = plan({ ...base, id: 'attempt-1' }).map(
      (entry) => entry.questionId,
    );
    const repeated = plan({ ...base, id: 'attempt-1' }).map(
      (entry) => entry.questionId,
    );
    const second = plan({ ...base, id: 'attempt-2' }).map(
      (entry) => entry.questionId,
    );

    expect(first).toHaveLength(3);
    expect(repeated).toEqual(first);
    expect(second).not.toEqual(first);
  });

  it('grades non-essay questions from the answer key without calling AI', async () => {
    gradeAnswer.mockClear();
    const grade = (
      service as unknown as {
        grade(
          user: { organizationId: string; sub: string },
          question: {
            type: QuestionType;
            prompt: string;
            answerKey: { correctOptionId: string };
            explanation: string;
          },
          maxScore: number,
          response: { selectedOptionId: string },
          studentAiEnabled: boolean,
        ): Promise<{ feedback: string; isCorrect: boolean }>;
      }
    ).grade(
      { organizationId: 'org-1', sub: 'student-1' },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: '2 + 2 เท่ากับเท่าไร',
        answerKey: { correctOptionId: 'four' },
        explanation: 'เพราะ 2 + 2 = 4',
      },
      1,
      { selectedOptionId: 'four' },
      true,
    );

    await expect(grade).resolves.toMatchObject({
      feedback: 'เพราะ 2 + 2 = 4',
      isCorrect: true,
    });
    expect(gradeAnswer).not.toHaveBeenCalled();
  });
});
