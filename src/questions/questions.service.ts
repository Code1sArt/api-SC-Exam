import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Difficulty,
  Prisma,
  QuestionSource,
  QuestionType,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateQuestionDto,
  GenerateQuestionsDto,
  ImportQuestionsDto,
  RemedialQuestionDto,
  UpdateQuestionDto,
} from './dto/question.dto';

export const decodeImportedNewlines = (value: string) =>
  value.replace(/\\r\\n|\\n|\\r/g, '\n');

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async findAll(
    user: AuthUser,
    query: {
      subjectId?: string;
      indicatorId?: string;
      type?: QuestionType;
      difficulty?: Difficulty;
      search?: string;
      page: number;
      limit: number;
    },
  ) {
    const where: Prisma.QuestionWhereInput = {
      organizationId: user.organizationId,
      isActive: true,
      subjectId: query.subjectId,
      indicatorId: query.indicatorId,
      type: query.type,
      difficulty: query.difficulty,
      ...(query.search?.trim()
        ? {
            OR: [
              { prompt: { contains: query.search.trim() } },
              { subject: { name: { contains: query.search.trim() } } },
              { subject: { code: { contains: query.search.trim() } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: {
          subject: { select: { id: true, code: true, name: true } },
          indicator: { select: { id: true, code: true, description: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.question.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async create(user: AuthUser, dto: CreateQuestionDto) {
    await this.requireAcademicRefs(
      user.organizationId,
      dto.subjectId,
      dto.indicatorId,
    );
    this.validateAnswer(dto.type, dto.options, dto.answerKey);
    return this.prisma.question.create({
      data: {
        ...dto,
        organizationId: user.organizationId,
        createdById: user.sub,
        options: dto.options as unknown as Prisma.InputJsonValue,
        answerKey: dto.answerKey as Prisma.InputJsonValue,
        tags: dto.tags,
      },
    });
  }

  async findOne(user: AuthUser, id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, organizationId: user.organizationId, isActive: true },
      include: {
        subject: { select: { id: true, code: true, name: true } },
        indicator: {
          select: { id: true, code: true, description: true, gradeLevel: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        parentQuestion: { select: { id: true, prompt: true } },
        _count: { select: { examItems: true, remedialQuestions: true } },
      },
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  async update(user: AuthUser, id: string, dto: UpdateQuestionDto) {
    const current = await this.prisma.question.findFirst({
      where: { id, organizationId: user.organizationId, isActive: true },
    });
    if (!current) throw new NotFoundException('Question not found');

    const subjectId = dto.subjectId ?? current.subjectId;
    const requestedIndicatorId = dto.indicatorId || null;
    const indicatorId =
      dto.indicatorId === undefined
        ? current.indicatorId
        : requestedIndicatorId;
    await this.requireAcademicRefs(
      user.organizationId,
      subjectId,
      indicatorId ?? undefined,
    );

    const type = dto.type ?? current.type;
    const options = dto.options ?? (current.options as unknown);
    const answerKey = dto.answerKey ?? (current.answerKey as unknown);
    this.validateAnswer(type, options, answerKey);

    await this.prisma.question.update({
      where: { id },
      data: {
        subjectId: dto.subjectId,
        indicatorId:
          dto.indicatorId === undefined ? undefined : requestedIndicatorId,
        type: dto.type,
        difficulty: dto.difficulty,
        prompt: dto.prompt,
        imageUrl: dto.imageUrl,
        options:
          dto.options === undefined
            ? undefined
            : (dto.options as unknown as Prisma.InputJsonValue),
        answerKey:
          dto.answerKey === undefined
            ? undefined
            : (dto.answerKey as Prisma.InputJsonValue),
        explanation: dto.explanation,
        maxScore: dto.maxScore,
        tags: dto.tags,
      },
    });
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!question) throw new NotFoundException('Question not found');

    await this.prisma.question.update({
      where: { id: question.id },
      data: { isActive: false },
    });
    return { deleted: true, id: question.id };
  }

  async removeMany(user: AuthUser, ids: string[]) {
    const questions = await this.prisma.question.findMany({
      where: {
        id: { in: ids },
        organizationId: user.organizationId,
        isActive: true,
      },
      select: { id: true },
    });
    const deletedIds = questions.map((question) => question.id);
    if (deletedIds.length) {
      await this.prisma.question.updateMany({
        where: {
          id: { in: deletedIds },
          organizationId: user.organizationId,
          isActive: true,
        },
        data: { isActive: false },
      });
    }
    return { deletedCount: deletedIds.length, deletedIds };
  }

  async generate(user: AuthUser, dto: GenerateQuestionsDto) {
    const refs = await this.requireAcademicRefs(
      user.organizationId,
      dto.subjectId,
      dto.indicatorId,
    );
    const generated = await this.ai.generateQuestions(
      { organizationId: user.organizationId, requestedById: user.sub },
      {
        subject: refs.subject.name,
        indicator: refs.indicator?.description,
        instruction: dto.instruction,
        count: dto.count,
        types: dto.types,
        difficulty: dto.difficulty,
        language: dto.language,
      },
    );

    const safe = generated.slice(0, dto.count);
    return this.prisma.$transaction(
      safe.map((question) =>
        this.prisma.question.create({
          data: {
            organizationId: user.organizationId,
            subjectId: dto.subjectId,
            indicatorId: dto.indicatorId,
            createdById: user.sub,
            source: QuestionSource.AI_GENERATED,
            type: this.enumOr(question.type, QuestionType, dto.types[0]),
            difficulty: this.enumOr(
              question.difficulty,
              Difficulty,
              dto.difficulty,
            ),
            prompt: String(question.prompt),
            options: question.options as unknown as Prisma.InputJsonValue,
            answerKey: question.answerKey as Prisma.InputJsonValue,
            explanation: question.explanation
              ? String(question.explanation)
              : undefined,
            maxScore: this.safeScore(question.maxScore),
            tags: question.tags,
          },
        }),
      ),
    );
  }

  async importJson(user: AuthUser, dto: ImportQuestionsDto) {
    const subject = await this.prisma.subject.findFirst({
      where: {
        organizationId: user.organizationId,
        code: dto.subjectCode.toUpperCase(),
      },
      select: { id: true, code: true },
    });
    if (!subject) {
      throw new BadRequestException(
        `Subject code ${dto.subjectCode} was not found`,
      );
    }
    const indicator = dto.indicatorCode
      ? await this.prisma.indicator.findFirst({
          where: {
            organizationId: user.organizationId,
            subjectId: subject.id,
            code: dto.indicatorCode,
          },
          select: { id: true },
        })
      : null;
    if (dto.indicatorCode && !indicator) {
      throw new BadRequestException(
        `Indicator code ${dto.indicatorCode} was not found in subject ${dto.subjectCode}`,
      );
    }

    const rows = dto.questions.map((question, index) => {
      try {
        this.validateAnswer(dto.type, question.options, question.answerKey);
      } catch (error) {
        throw new BadRequestException(
          `Question ${index + 1}: ${error instanceof Error ? error.message : 'invalid answer'}`,
        );
      }
      return {
        organizationId: user.organizationId,
        subjectId: subject.id,
        indicatorId: indicator?.id ?? undefined,
        createdById: user.sub,
        source: QuestionSource.MANUAL,
        type: dto.type,
        difficulty: dto.difficulty,
        prompt: decodeImportedNewlines(question.prompt),
        imageUrl: question.imageUrl,
        options: question.options?.map((option) => ({
          ...option,
          text: decodeImportedNewlines(option.text),
        })) as unknown as Prisma.InputJsonValue,
        answerKey: question.answerKey as Prisma.InputJsonValue,
        explanation:
          question.explanation === undefined
            ? undefined
            : decodeImportedNewlines(question.explanation),
        maxScore: question.maxScore,
        tags: question.tags,
      };
    });

    const imported = await this.prisma.$transaction(
      rows.map((data) =>
        this.prisma.question.create({ data, select: { id: true } }),
      ),
    );
    return {
      importedCount: imported.length,
      ids: imported.map(({ id }) => id),
    };
  }

  async generateRemedial(
    user: AuthUser,
    questionId: string,
    dto: RemedialQuestionDto,
  ) {
    const original = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        organizationId: user.organizationId,
        isActive: true,
      },
    });
    if (!original) throw new NotFoundException('Question not found');

    const generated = await this.ai.generateRemedialQuestion(
      { organizationId: user.organizationId, requestedById: user.sub },
      {
        originalPrompt: original.prompt,
        originalAnswer: original.answerKey,
        studentResponse: dto.response,
        feedback: dto.feedback,
        type: original.type,
        difficulty: this.lowerDifficulty(original.difficulty),
      },
    );
    return this.prisma.question.create({
      data: {
        organizationId: user.organizationId,
        subjectId: original.subjectId,
        indicatorId: original.indicatorId,
        createdById: user.sub,
        parentQuestionId: original.id,
        source: QuestionSource.AI_REMEDIAL,
        type: this.enumOr(generated.type, QuestionType, original.type),
        difficulty: this.enumOr(
          generated.difficulty,
          Difficulty,
          this.lowerDifficulty(original.difficulty),
        ),
        prompt: String(generated.prompt),
        options: generated.options as unknown as Prisma.InputJsonValue,
        answerKey: generated.answerKey as Prisma.InputJsonValue,
        explanation: generated.explanation,
        maxScore: this.safeScore(generated.maxScore),
        tags: generated.tags,
      },
    });
  }

  private async requireAcademicRefs(
    organizationId: string,
    subjectId: string,
    indicatorId?: string,
  ) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, organizationId },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    const indicator = indicatorId
      ? await this.prisma.indicator.findFirst({
          where: { id: indicatorId, subjectId, organizationId },
        })
      : null;
    if (indicatorId && !indicator)
      throw new NotFoundException('Indicator not found');
    return { subject, indicator };
  }

  private lowerDifficulty(difficulty: Difficulty) {
    const levels = Object.values(Difficulty);
    return levels[Math.max(0, levels.indexOf(difficulty) - 1)];
  }

  private safeScore(value: unknown) {
    const score = Number(value);
    return Number.isFinite(score) && score > 0 && score <= 1000 ? score : 1;
  }

  private validateAnswer(
    type: QuestionType,
    options: unknown,
    answerKey: unknown,
  ) {
    if (!answerKey || typeof answerKey !== 'object' || Array.isArray(answerKey))
      throw new BadRequestException('Answer key is required');
    if (
      type === QuestionType.MULTIPLE_CHOICE ||
      type === QuestionType.TRUE_FALSE
    ) {
      if (!Array.isArray(options) || options.length < 2)
        throw new BadRequestException('At least two options are required');
      const optionIds = options
        .filter(
          (option): option is { id: unknown } =>
            !!option && typeof option === 'object' && 'id' in option,
        )
        .map((option) => String(option.id));
      const rawCorrectOptionId = (answerKey as Record<string, unknown>)
        .correctOptionId;
      const correctOptionId =
        typeof rawCorrectOptionId === 'string' ||
        typeof rawCorrectOptionId === 'number'
          ? String(rawCorrectOptionId)
          : '';
      if (!correctOptionId || !optionIds.includes(correctOptionId))
        throw new BadRequestException('Correct answer must match an option');
    }
  }

  private enumOr<T extends string>(
    value: unknown,
    enumObject: Record<string, T>,
    fallback: T,
  ): T {
    return Object.values(enumObject).includes(value as T)
      ? (value as T)
      : fallback;
  }
}
