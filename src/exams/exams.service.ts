import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttemptStatus,
  Difficulty,
  ExamStatus,
  Prisma,
  QuestionType,
  UserRole,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { GradeResult, LearningReport } from '../ai/ai.types';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptiveService, DIFFICULTY_LEVELS } from './adaptive.service';
import { CreateExamDto, SubmitAnswerDto } from './dto/exam.dto';

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly adaptive: AdaptiveService,
  ) {}

  async create(user: AuthUser, dto: CreateExamDto) {
    const [classroom, subject, questions] = await Promise.all([
      this.prisma.classroom.findFirst({
        where: {
          id: dto.classroomId,
          organizationId: user.organizationId,
          isActive: true,
          ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
        },
      }),
      this.prisma.subject.findFirst({
        where: { id: dto.subjectId, organizationId: user.organizationId },
      }),
      this.prisma.question.findMany({
        where: {
          id: { in: dto.items.map((item) => item.questionId) },
          organizationId: user.organizationId,
          subjectId: dto.subjectId,
          isActive: true,
        },
        select: { id: true },
      }),
    ]);
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (!subject) throw new NotFoundException('Subject not found');
    if (questions.length !== new Set(dto.items.map((i) => i.questionId)).size)
      throw new BadRequestException('One or more questions are invalid');

    return this.prisma.exam.create({
      data: {
        organizationId: user.organizationId,
        classroomId: dto.classroomId,
        subjectId: dto.subjectId,
        createdById: user.sub,
        title: dto.title,
        description: dto.description,
        isAdaptive: dto.isAdaptive,
        durationMinutes: dto.durationMinutes,
        availableFrom: dto.availableFrom
          ? new Date(dto.availableFrom)
          : undefined,
        availableUntil: dto.availableUntil
          ? new Date(dto.availableUntil)
          : undefined,
        maxAttempts: dto.maxAttempts,
        items: {
          create: dto.items.map((item, index) => ({
            questionId: item.questionId,
            position: index + 1,
            score: item.score,
          })),
        },
      },
      include: { items: { include: { question: true } } },
    });
  }

  list(user: AuthUser) {
    if (user.role === UserRole.STUDENT) return this.listForStudent(user);
    return this.prisma.exam.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
      include: {
        classroom: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        _count: { select: { items: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async publish(user: AuthUser, examId: string) {
    const exam = await this.requireManagedExam(user, examId);
    if (exam.status !== ExamStatus.DRAFT)
      throw new BadRequestException('Only draft exams can be published');
    return this.prisma.exam.update({
      where: { id: exam.id },
      data: { status: ExamStatus.PUBLISHED },
    });
  }

  async setAvailability(user: AuthUser, examId: string, isOpen: boolean) {
    const exam = await this.requireManagedExam(user, examId);
    if (exam.status === ExamStatus.ARCHIVED) {
      throw new BadRequestException('Archived exams cannot be reopened');
    }
    const status = isOpen ? ExamStatus.PUBLISHED : ExamStatus.CLOSED;
    if (exam.status === status) return exam;
    return this.prisma.exam.update({
      where: { id: exam.id },
      data: { status },
    });
  }

  async resetAttempt(user: AuthUser, examId: string, attemptId: string) {
    await this.requireManagedExam(user, examId);
    const selectedAttempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, examId },
      select: { studentId: true },
    });
    if (!selectedAttempt) throw new NotFoundException('Attempt not found');

    const attemptsToDelete = await this.prisma.examAttempt.findMany({
      where: { examId, studentId: selectedAttempt.studentId },
      select: {
        answers: {
          select: { question: { select: { indicatorId: true } } },
        },
      },
    });
    const indicatorIds = [
      ...new Set(
        attemptsToDelete
          .flatMap((attempt) => attempt.answers)
          .map((answer) => answer.question.indicatorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.examAttempt.deleteMany({
        where: { examId, studentId: selectedAttempt.studentId },
      });

      if (indicatorIds.length) {
        await tx.studentMastery.deleteMany({
          where: {
            studentId: selectedAttempt.studentId,
            indicatorId: { in: indicatorIds },
          },
        });
        const remainingAnswers = await tx.attemptAnswer.findMany({
          where: {
            attempt: { studentId: selectedAttempt.studentId },
            question: { indicatorId: { in: indicatorIds } },
          },
          select: {
            isCorrect: true,
            question: {
              select: { indicatorId: true, difficulty: true },
            },
          },
          orderBy: { answeredAt: 'asc' },
        });
        for (const answer of remainingAnswers) {
          if (!answer.question.indicatorId || answer.isCorrect === null)
            continue;
          await this.updateMastery(
            tx,
            selectedAttempt.studentId,
            answer.question.indicatorId,
            answer.isCorrect,
            answer.question.difficulty,
          );
        }
      }
      return deleted.count;
    });

    return {
      examId,
      studentId: selectedAttempt.studentId,
      deletedAttempts: deletedCount,
    };
  }

  async lockedAttempts(user: AuthUser) {
    return this.prisma.examAttempt.findMany({
      where: {
        status: AttemptStatus.IN_PROGRESS,
        lockedAt: { not: null },
        exam: {
          organizationId: user.organizationId,
          ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
        },
      },
      select: {
        id: true,
        attemptNumber: true,
        lockedAt: true,
        lockReason: true,
        violationCount: true,
        lastViolationAt: true,
        exam: {
          select: {
            id: true,
            title: true,
            classroom: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true } },
          },
        },
        student: {
          select: {
            studentCode: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { lockedAt: 'desc' },
    });
  }

  async unlockAttempt(user: AuthUser, attemptId: string) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        status: AttemptStatus.IN_PROGRESS,
        lockedAt: { not: null },
        exam: {
          organizationId: user.organizationId,
          ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
        },
      },
      select: { id: true },
    });
    if (!attempt) throw new NotFoundException('Locked attempt not found');
    return this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: { lockedAt: null, lockReason: null },
      select: {
        id: true,
        lockedAt: true,
        lockReason: true,
        violationCount: true,
      },
    });
  }

  async start(user: AuthUser, examId: string) {
    if (user.role !== UserRole.STUDENT)
      throw new ForbiddenException('Only students can start an exam');
    const profile = await this.studentProfile(user);
    const now = new Date();
    const exam = await this.prisma.exam.findFirst({
      where: {
        id: examId,
        organizationId: user.organizationId,
        status: ExamStatus.PUBLISHED,
        classroom: {
          enrollments: { some: { studentId: profile.id } },
        },
      },
      include: { _count: { select: { attempts: true } } },
    });
    if (!exam) throw new NotFoundException('Available exam not found');
    if (exam.availableFrom && exam.availableFrom > now)
      throw new BadRequestException('Exam is not open yet');
    if (exam.availableUntil && exam.availableUntil < now)
      throw new BadRequestException('Exam has closed');

    const existingAttempt = await this.prisma.examAttempt.findFirst({
      where: {
        examId,
        studentId: profile.id,
        status: AttemptStatus.IN_PROGRESS,
      },
      orderBy: { attemptNumber: 'desc' },
    });
    if (existingAttempt) {
      return {
        attempt: existingAttempt,
        nextQuestion: existingAttempt.lockedAt
          ? null
          : await this.nextQuestion(user, existingAttempt.id),
      };
    }

    const priorCount = await this.prisma.examAttempt.count({
      where: { examId, studentId: profile.id },
    });
    if (priorCount >= exam.maxAttempts) {
      const concurrentAttempt = await this.prisma.examAttempt.findFirst({
        where: {
          examId,
          studentId: profile.id,
          status: AttemptStatus.IN_PROGRESS,
        },
        orderBy: { attemptNumber: 'desc' },
      });
      if (concurrentAttempt) {
        return {
          attempt: concurrentAttempt,
          nextQuestion: concurrentAttempt.lockedAt
            ? null
            : await this.nextQuestion(user, concurrentAttempt.id),
        };
      }
      throw new BadRequestException('Maximum attempts reached');
    }

    let attempt;
    try {
      attempt = await this.prisma.examAttempt.create({
        data: {
          examId,
          studentId: profile.id,
          attemptNumber: priorCount + 1,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const concurrentAttempt = await this.prisma.examAttempt.findFirst({
        where: {
          examId,
          studentId: profile.id,
          status: AttemptStatus.IN_PROGRESS,
        },
        orderBy: { attemptNumber: 'desc' },
      });
      if (!concurrentAttempt) throw error;
      attempt = concurrentAttempt;
    }
    return { attempt, nextQuestion: await this.nextQuestion(user, attempt.id) };
  }

  async nextQuestion(user: AuthUser, attemptId: string) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) return null;
    this.assertAttemptUnlocked(attempt);
    this.assertWithinDuration(attempt);

    const answeredIds = attempt.answers.map((answer) => answer.questionId);
    const remaining = attempt.exam.items.filter(
      (item) => !answeredIds.includes(item.questionId),
    );
    if (!remaining.length) return null;

    const item = attempt.exam.isAdaptive
      ? remaining.sort(
          (a, b) =>
            Math.abs(
              DIFFICULTY_LEVELS.indexOf(a.question.difficulty) -
                DIFFICULTY_LEVELS.indexOf(attempt.currentDifficulty),
            ) -
            Math.abs(
              DIFFICULTY_LEVELS.indexOf(b.question.difficulty) -
                DIFFICULTY_LEVELS.indexOf(attempt.currentDifficulty),
            ),
        )[0]
      : remaining.sort((a, b) => a.position - b.position)[0];

    return {
      id: item.question.id,
      type: item.question.type,
      difficulty: item.question.difficulty,
      prompt: item.question.prompt,
      options: item.question.options,
      score: item.score,
      position: item.position,
      progress: {
        answered: attempt.answers.length,
        total: attempt.exam.items.length,
        currentDifficulty: attempt.currentDifficulty,
      },
    };
  }

  async answer(
    user: AuthUser,
    attemptId: string,
    questionId: string,
    dto: SubmitAnswerDto,
  ) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt is not in progress');
    this.assertAttemptUnlocked(attempt);
    this.assertWithinDuration(attempt);
    if (attempt.answers.some((answer) => answer.questionId === questionId))
      throw new BadRequestException('Question has already been answered');
    const item = attempt.exam.items.find(
      (examItem) => examItem.questionId === questionId,
    );
    if (!item) throw new BadRequestException('Question is not in this exam');

    const studentAiEnabled = await this.ai.isStudentAiEnabled(
      user.organizationId,
    );
    const grade = await this.grade(
      user,
      item.question,
      Number(item.score),
      dto.response,
      studentAiEnabled,
    );
    const state = this.adaptive.nextState(
      attempt,
      grade.isCorrect,
      attempt.exam.isAdaptive,
    );

    const answer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attemptAnswer.create({
        data: {
          attemptId,
          questionId,
          response: dto.response as Prisma.InputJsonValue,
          score: grade.score,
          isCorrect: grade.isCorrect,
          aiFeedback: studentAiEnabled ? grade.feedback : null,
          aiConfidence: grade.confidence,
          gradedAt: new Date(),
        },
      });
      await tx.examAttempt.update({
        where: { id: attemptId },
        data: state,
      });
      if (item.question.indicatorId) {
        await this.updateMastery(
          tx,
          attempt.studentId,
          item.question.indicatorId,
          grade.isCorrect,
          item.question.difficulty,
        );
      }
      return created;
    });
    return {
      answer,
      adaptiveState: state,
      nextQuestion: await this.nextQuestion(user, attemptId),
    };
  }

  async submit(user: AuthUser, attemptId: string) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt has already been submitted');
    this.assertAttemptUnlocked(attempt);
    const score = attempt.answers.reduce(
      (total, answer) => total + Number(answer.score ?? 0),
      0,
    );
    const maxScore = attempt.exam.items.reduce(
      (total, item) => total + Number(item.score),
      0,
    );
    const percentage = maxScore ? (score / maxScore) * 100 : 0;
    const summary = {
      score,
      maxScore,
      percentage,
      answered: attempt.answers.length,
      totalQuestions: attempt.exam.items.length,
      indicators: this.indicatorSummary(attempt),
    };
    const studentAiEnabled = await this.ai.isStudentAiEnabled(
      user.organizationId,
    );
    let report: LearningReport | null = null;
    if (studentAiEnabled) {
      try {
        report = await this.ai.generateReport(
          { organizationId: user.organizationId, requestedById: user.sub },
          summary,
        );
      } catch {
        report = this.fallbackReport(percentage);
      }
    }
    await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: AttemptStatus.GRADED,
        score,
        maxScore,
        percentage,
        aiReport:
          report === null
            ? Prisma.DbNull
            : (report as unknown as Prisma.InputJsonValue),
        submittedAt: new Date(),
        gradedAt: new Date(),
      },
    });
    return this.attemptResult(user, attemptId);
  }

  async attemptResult(user: AuthUser, attemptId: string) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status === AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt has not been submitted');
    const studentAiEnabled = await this.ai.isStudentAiEnabled(
      user.organizationId,
    );
    return {
      id: attempt.id,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      aiReport: studentAiEnabled ? attempt.aiReport : null,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        isAdaptive: attempt.exam.isAdaptive,
        classroom: attempt.exam.classroom,
        subject: attempt.exam.subject,
      },
      answers: attempt.answers.map((answer) => {
        const item = attempt.exam.items.find(
          (examItem) => examItem.questionId === answer.questionId,
        );
        return {
          id: answer.id,
          response: answer.response,
          score: answer.score,
          isCorrect: answer.isCorrect,
          aiFeedback: studentAiEnabled ? answer.aiFeedback : null,
          question: item
            ? {
                id: item.question.id,
                type: item.question.type,
                prompt: item.question.prompt,
                position: item.position,
                maxScore: item.score,
              }
            : null,
        };
      }),
    };
  }

  async attemptStatus(user: AuthUser, attemptId: string) {
    const profile = await this.studentProfile(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        studentId: profile.id,
        exam: { organizationId: user.organizationId },
      },
      select: {
        id: true,
        status: true,
        lockedAt: true,
        lockReason: true,
        violationCount: true,
        lastViolationAt: true,
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  async reportViolation(user: AuthUser, attemptId: string, type: string) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt is not in progress');
    const now = new Date();
    return this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: {
        lockedAt: attempt.lockedAt ?? now,
        lockReason: attempt.lockReason ?? type,
        violationCount: { increment: 1 },
        lastViolationAt: now,
      },
      select: {
        id: true,
        status: true,
        lockedAt: true,
        lockReason: true,
        violationCount: true,
        lastViolationAt: true,
      },
    });
  }

  private async listForStudent(user: AuthUser) {
    const profile = await this.studentProfile(user);
    return this.prisma.exam.findMany({
      where: {
        organizationId: user.organizationId,
        classroom: { enrollments: { some: { studentId: profile.id } } },
        OR: [
          { status: ExamStatus.PUBLISHED },
          { attempts: { some: { studentId: profile.id } } },
        ],
      },
      include: {
        classroom: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        attempts: {
          where: { studentId: profile.id },
          select: {
            id: true,
            status: true,
            percentage: true,
            attemptNumber: true,
            score: true,
            maxScore: true,
            startedAt: true,
            submittedAt: true,
            lockedAt: true,
            lockReason: true,
            violationCount: true,
            lastViolationAt: true,
          },
          orderBy: { attemptNumber: 'asc' },
        },
        _count: { select: { items: true } },
      },
      orderBy: { availableFrom: 'asc' },
    });
  }

  private async grade(
    user: AuthUser,
    question: {
      type: QuestionType;
      prompt: string;
      answerKey: Prisma.JsonValue;
      explanation: string | null;
    },
    maxScore: number,
    response: unknown,
    studentAiEnabled: boolean,
  ): Promise<GradeResult> {
    if (question.type === QuestionType.ESSAY) {
      const aiGrade = await this.ai.gradeAnswer(
        { organizationId: user.organizationId, requestedById: user.sub },
        {
          prompt: question.prompt,
          answerKey: question.answerKey,
          response,
          maxScore,
        },
      );
      const result = {
        score: Math.min(maxScore, Math.max(0, Number(aiGrade.score) || 0)),
        isCorrect: aiGrade.isCorrect,
        feedback: aiGrade.feedback,
        confidence: this.clamp(aiGrade.confidence),
      };
      return studentAiEnabled
        ? result
        : { ...result, feedback: 'ระบบตรวจคำตอบและบันทึกผลเรียบร้อยแล้ว' };
    }
    const isCorrect = this.isObjectivelyCorrect(question.answerKey, response);
    let feedback =
      question.explanation ||
      (isCorrect ? 'คำตอบถูกต้อง' : 'คำตอบยังไม่ถูกต้อง ลองทบทวนอีกครั้ง');
    let confidence = 1;
    if (studentAiEnabled) {
      try {
        const aiGrade = await this.ai.gradeAnswer(
          { organizationId: user.organizationId, requestedById: user.sub },
          {
            prompt: question.prompt,
            answerKey: question.answerKey,
            response,
            maxScore,
          },
        );
        feedback = aiGrade.feedback || feedback;
        confidence = this.clamp(aiGrade.confidence);
      } catch {
        // Objective grading remains available when the optional reasoning AI is down.
      }
    }
    return {
      score: isCorrect ? maxScore : 0,
      isCorrect,
      feedback,
      confidence,
    };
  }

  private fallbackReport(percentage: number): LearningReport {
    const group =
      percentage >= 80
        ? ('STRONG' as const)
        : percentage >= 50
          ? ('AVERAGE' as const)
          : ('NEEDS_SUPPORT' as const);
    return {
      summary: `ทำคะแนนได้ ${percentage.toFixed(0)}% ระบบบันทึกผลเรียบร้อยแล้ว`,
      strengths: percentage >= 50 ? ['มีความเข้าใจเนื้อหาพื้นฐาน'] : [],
      weaknesses: percentage < 80 ? ['ควรทบทวนข้อที่ตอบผิด'] : [],
      recommendations: ['ทบทวนคำอธิบายรายข้อและลองทำแบบฝึกเพิ่มเติม'],
      group,
    };
  }

  private isObjectivelyCorrect(answerKey: Prisma.JsonValue, response: unknown) {
    const key = answerKey as Record<string, unknown>;
    const answer = response as Record<string, unknown>;
    const expected =
      key.correctOptionId ?? key.value ?? key.answer ?? key.correctAnswer;
    const actual =
      answer && typeof answer === 'object'
        ? (answer.selectedOptionId ?? answer.value ?? answer.answer)
        : response;
    if (Array.isArray(key.acceptedAnswers)) {
      return key.acceptedAnswers.some(
        (candidate) => this.normalize(candidate) === this.normalize(actual),
      );
    }
    return this.normalize(expected) === this.normalize(actual);
  }

  private async updateMastery(
    tx: Prisma.TransactionClient,
    studentId: string,
    indicatorId: string,
    correct: boolean,
    difficulty: Difficulty,
  ) {
    const current = await tx.studentMastery.findUnique({
      where: { studentId_indicatorId: { studentId, indicatorId } },
    });
    const sampleSize = (current?.sampleSize ?? 0) + 1;
    const priorCorrect = Number(current?.correctRate ?? 0) * (sampleSize - 1);
    const correctRate = (priorCorrect + (correct ? 1 : 0)) / sampleSize;
    const challenge = DIFFICULTY_LEVELS.indexOf(difficulty) - 2;
    const ability = Math.max(
      -3,
      Math.min(3, correctRate * 4 - 2 + challenge * 0.15),
    );
    await tx.studentMastery.upsert({
      where: { studentId_indicatorId: { studentId, indicatorId } },
      create: { studentId, indicatorId, sampleSize, correctRate, ability },
      update: { sampleSize, correctRate, ability },
    });
  }

  private async requireManagedExam(user: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: {
        id: examId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private async requireAttempt(user: AuthUser, attemptId: string) {
    const profile =
      user.role === UserRole.STUDENT ? await this.studentProfile(user) : null;
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        exam: { organizationId: user.organizationId },
        ...(profile ? { studentId: profile.id } : {}),
      },
      include: {
        answers: true,
        exam: {
          include: {
            classroom: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true } },
            items: {
              include: { question: true },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  private async studentProfile(user: AuthUser) {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { userId: user.sub, organizationId: user.organizationId },
    });
    if (!profile) throw new ForbiddenException('Student profile not found');
    return profile;
  }

  private assertWithinDuration(attempt: {
    startedAt: Date;
    exam: { durationMinutes: number | null };
  }) {
    if (
      attempt.exam.durationMinutes &&
      Date.now() >
        attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60_000
    )
      throw new BadRequestException('Exam duration has expired');
  }

  private assertAttemptUnlocked(attempt: {
    lockedAt: Date | null;
    lockReason: string | null;
  }) {
    if (!attempt.lockedAt) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        message: 'Exam attempt is locked',
        error: 'Locked',
        lockReason: attempt.lockReason,
        lockedAt: attempt.lockedAt,
      },
      HttpStatus.LOCKED,
    );
  }

  private indicatorSummary(
    attempt: Awaited<ReturnType<ExamsService['requireAttempt']>>,
  ) {
    const groups = new Map<string, { correct: number; total: number }>();
    for (const answer of attempt.answers) {
      const question = attempt.exam.items.find(
        (item) => item.questionId === answer.questionId,
      )?.question;
      if (!question?.indicatorId) continue;
      const current = groups.get(question.indicatorId) ?? {
        correct: 0,
        total: 0,
      };
      current.total += 1;
      if (answer.isCorrect) current.correct += 1;
      groups.set(question.indicatorId, current);
    }
    return Array.from(groups.entries()).map(([indicatorId, value]) => ({
      indicatorId,
      ...value,
      correctRate: value.total ? value.correct / value.total : 0,
    }));
  }

  private normalize(value: unknown) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    )
      return '';
    return String(value).trim().toLocaleLowerCase('th-TH');
  }

  private clamp(value: unknown) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }
}
