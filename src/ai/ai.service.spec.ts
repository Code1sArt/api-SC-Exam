import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Difficulty, QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';

describe('AiService token budget', () => {
  const input = {
    subject: 'Mathematics',
    count: 1,
    types: [QuestionType.SHORT_ANSWER],
    difficulty: Difficulty.MEDIUM,
    language: 'Thai',
  };

  const createService = (
    monthlyBudget: number,
    tokenUsage: Array<Record<string, number>>,
  ) => {
    const organizationFindUniqueOrThrow = jest
      .fn()
      .mockImplementation(({ select }: { select: Record<string, boolean> }) =>
        select.aiMonthlyTokenBudget
          ? { aiMonthlyTokenBudget: monthlyBudget }
          : {
              aiGenerationModel: 'generation-model',
              aiReasoningModel: 'reasoning-model',
              aiReportModel: 'report-model',
            },
      );
    const aiRequestCreate = jest
      .fn()
      .mockResolvedValue({ id: 'ai-request-id' });
    const prisma = {
      organization: { findUniqueOrThrow: organizationFindUniqueOrThrow },
      aiRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            tokenUsage.map((value) => ({ tokenUsage: value })),
          ),
        create: aiRequestCreate,
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'AI_MOCK_MODE' ? 'true' : fallback,
      ),
    } as unknown as ConfigService;

    return {
      service: new AiService(config, prisma),
      aiRequestCreate,
    };
  };

  it('blocks AI immediately when the monthly token budget is zero', async () => {
    const { service, aiRequestCreate } = createService(0, []);

    await expect(
      service.generateQuestions({ organizationId: 'org-1' }, input),
    ).rejects.toThrow(ForbiddenException);
    expect(aiRequestCreate).not.toHaveBeenCalled();
  });

  it('blocks AI when this month usage has reached the token budget', async () => {
    const { service, aiRequestCreate } = createService(100, [
      { inputTokens: 60, outputTokens: 40, totalTokens: 100 },
    ]);

    await expect(
      service.generateQuestions({ organizationId: 'org-1' }, input),
    ).rejects.toThrow('โควตา Token สำหรับ AI ขององค์กรหมดแล้ว');
    expect(aiRequestCreate).not.toHaveBeenCalled();
  });

  it('allows AI while this month usage remains below the token budget', async () => {
    const { service, aiRequestCreate } = createService(1_000, [
      { inputTokens: 60, outputTokens: 40, totalTokens: 100 },
    ]);

    await expect(
      service.generateQuestions({ organizationId: 'org-1' }, input),
    ).resolves.toHaveLength(1);
    expect(aiRequestCreate).toHaveBeenCalledTimes(1);
  });
});
