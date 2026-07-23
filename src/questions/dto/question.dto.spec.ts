import { ValidationPipe } from '@nestjs/common';
import { Difficulty, QuestionType } from '@prisma/client';
import { CreateQuestionDto, ImportQuestionsDto } from './question.dto';

describe('CreateQuestionDto', () => {
  it('preserves option id and text when the global validation pipe transforms input', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    const result = (await pipe.transform(
      {
        subjectId: 'subject-1',
        type: QuestionType.MULTIPLE_CHOICE,
        difficulty: Difficulty.EASY,
        prompt: 'คำถามตัวอย่าง',
        options: [
          { id: 'A', text: 'ตัวเลือก ก' },
          { id: 'B', text: 'ตัวเลือก ข' },
        ],
        answerKey: { correctOptionId: 'B' },
        maxScore: 1,
      },
      { type: 'body', metatype: CreateQuestionDto },
    )) as CreateQuestionDto;

    expect(result.options).toEqual([
      { id: 'A', text: 'ตัวเลือก ก' },
      { id: 'B', text: 'ตัวเลือก ข' },
    ]);
  });
});

describe('ImportQuestionsDto', () => {
  it('validates and preserves nested JSON question data', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    const result = (await pipe.transform(
      {
        subjectCode: 'MATH',
        type: QuestionType.SHORT_ANSWER,
        difficulty: Difficulty.MEDIUM,
        questions: [
          {
            prompt: '5 คูณ 6 มีค่าเท่าใด',
            answerKey: { acceptedAnswers: ['30'] },
            maxScore: 1,
            tags: ['การคูณ'],
          },
        ],
      },
      { type: 'body', metatype: ImportQuestionsDto },
    )) as ImportQuestionsDto;

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].answerKey).toEqual({
      acceptedAnswers: ['30'],
    });
    expect(result.questions[0].tags).toEqual(['การคูณ']);
  });
});
