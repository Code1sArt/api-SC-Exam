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
import { CreateExamDto, SubmitAnswerDto, UpdateExamDto } from './dto/exam.dto';

type ResetAttemptSnapshot = {
  attempts: Array<{
    id: string;
    examId: string;
    studentId: string;
    attemptNumber: number;
    status: AttemptStatus;
    currentDifficulty: Difficulty;
    correctStreak: number;
    incorrectStreak: number;
    score: string | null;
    maxScore: string | null;
    percentage: string | null;
    aiReport: Prisma.JsonValue | null;
    lockedAt: string | null;
    lockReason: string | null;
    violationCount: number;
    lastViolationAt: string | null;
    startedAt: string;
    submittedAt: string | null;
    gradedAt: string | null;
    answers: Array<{
      id: string;
      questionId: string;
      response: Prisma.JsonValue;
      score: string | null;
      isCorrect: boolean | null;
      aiFeedback: string | null;
      aiConfidence: string | null;
      answeredAt: string;
      gradedAt: string | null;
    }>;
  }>;
};

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly adaptive: AdaptiveService,
  ) {}

  async create(user: AuthUser, dto: CreateExamDto) {
    const classroomIds = this.classroomIds(dto);
    const [classrooms, subject, questions] = await Promise.all([
      this.prisma.classroom.findMany({
        where: {
          id: { in: classroomIds },
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
    if (classrooms.length !== classroomIds.length)
      throw new NotFoundException('One or more classrooms not found');
    if (!subject) throw new NotFoundException('Subject not found');
    if (questions.length !== new Set(dto.items.map((i) => i.questionId)).size)
      throw new BadRequestException('One or more questions are invalid');
    await this.validateQuestionSelection(user, dto);

    return this.prisma.$transaction(
      classroomIds.map((classroomId) =>
        this.prisma.exam.create({
          data: {
            organizationId: user.organizationId,
            classroomId,
            subjectId: dto.subjectId,
            createdById: user.sub,
            title: dto.title,
            description: dto.description,
            isAdaptive: dto.isAdaptive,
            questionCount: dto.questionCount,
            essayQuestionCount: dto.essayQuestionCount ?? null,
            questionTypeCounts: dto.questionTypeCounts
              ? (dto.questionTypeCounts as Prisma.InputJsonValue)
              : undefined,
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
        }),
      ),
    );
  }

  async update(user: AuthUser, examId: string, dto: UpdateExamDto) {
    const exam = await this.requireManagedExam(user, examId);
    const attemptCount = await this.prisma.examAttempt.count({
      where: { examId },
    });
    if (attemptCount)
      throw new BadRequestException(
        'Exams with attempts cannot be edited; close the exam and create a new copy instead',
      );

    const currentItems = await this.prisma.examItem.findMany({
      where: { examId },
      orderBy: { position: 'asc' },
    });
    const merged: CreateExamDto = {
      classroomId: dto.classroomId ?? exam.classroomId,
      subjectId: dto.subjectId ?? exam.subjectId,
      title: dto.title ?? exam.title,
      description: dto.description ?? exam.description ?? undefined,
      isAdaptive: dto.isAdaptive ?? exam.isAdaptive,
      questionCount: dto.questionCount ?? exam.questionCount,
      essayQuestionCount:
        dto.essayQuestionCount === undefined
          ? exam.essayQuestionCount
          : dto.essayQuestionCount,
      questionTypeCounts:
        dto.questionTypeCounts ??
        this.typeCounts(exam.questionTypeCounts) ??
        undefined,
      durationMinutes: dto.durationMinutes ?? exam.durationMinutes ?? undefined,
      availableFrom: dto.availableFrom ?? exam.availableFrom?.toISOString(),
      availableUntil: dto.availableUntil ?? exam.availableUntil?.toISOString(),
      maxAttempts: dto.maxAttempts ?? exam.maxAttempts,
      items:
        dto.items ??
        currentItems.map((item) => ({
          questionId: item.questionId,
          score: Number(item.score),
        })),
    };
    await this.validateQuestionSelection(user, merged);

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.examItem.deleteMany({ where: { examId } });
      }
      return tx.exam.update({
        where: { id: examId },
        data: {
          classroomId: merged.classroomId,
          subjectId: merged.subjectId,
          title: merged.title,
          description: merged.description,
          isAdaptive: merged.isAdaptive,
          questionCount: merged.questionCount,
          essayQuestionCount: merged.essayQuestionCount ?? null,
          questionTypeCounts: merged.questionTypeCounts
            ? (merged.questionTypeCounts as Prisma.InputJsonValue)
            : Prisma.DbNull,
          durationMinutes: merged.durationMinutes,
          availableFrom: merged.availableFrom
            ? new Date(merged.availableFrom)
            : null,
          availableUntil: merged.availableUntil
            ? new Date(merged.availableUntil)
            : null,
          maxAttempts: merged.maxAttempts,
          ...(dto.items
            ? {
                items: {
                  create: merged.items.map((item, index) => ({
                    questionId: item.questionId,
                    position: index + 1,
                    score: item.score,
                  })),
                },
              }
            : {}),
        },
        include: { items: { include: { question: true } } },
      });
    });
  }

  async remove(user: AuthUser, examId: string) {
    await this.requireManagedExam(user, examId);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId },
      select: {
        studentId: true,
        answers: {
          select: { question: { select: { indicatorId: true } } },
        },
      },
    });
    const masteryPairsByKey = new Map<
      string,
      { studentId: string; indicatorId: string }
    >();
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const { indicatorId } = answer.question;
        if (!indicatorId) continue;
        masteryPairsByKey.set(`${attempt.studentId}:${indicatorId}`, {
          studentId: attempt.studentId,
          indicatorId,
        });
      }
    }
    const masteryPairs = [...masteryPairsByKey.values()];

    await this.prisma.$transaction(async (tx) => {
      await tx.exam.delete({ where: { id: examId } });
      if (!masteryPairs.length) return;
      await tx.studentMastery.deleteMany({
        where: { OR: masteryPairs },
      });
      const remainingAnswers = await tx.attemptAnswer.findMany({
        where: {
          OR: masteryPairs.map(({ studentId, indicatorId }) => ({
            attempt: { studentId },
            question: { indicatorId },
          })),
        },
        select: {
          attempt: { select: { studentId: true } },
          isCorrect: true,
          question: { select: { indicatorId: true, difficulty: true } },
        },
        orderBy: { answeredAt: 'asc' },
      });
      for (const answer of remainingAnswers) {
        if (answer.isCorrect === null || !answer.question.indicatorId) continue;
        await this.updateMastery(
          tx,
          answer.attempt.studentId,
          answer.question.indicatorId,
          answer.isCorrect,
          answer.question.difficulty,
        );
      }
    });
    return { id: examId, deleted: true, deletedAttempts: attempts.length };
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
        items: {
          include: {
            question: {
              select: {
                id: true,
                type: true,
                difficulty: true,
                prompt: true,
                imageUrl: true,
                source: true,
                maxScore: true,
                subjectId: true,
                subject: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { position: 'asc' },
        },
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

  async updateResultMaxScore(user: AuthUser, examId: string, maxScore: number) {
    const exam = await this.requireManagedExam(user, examId);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId, status: AttemptStatus.GRADED },
      select: { id: true, score: true, maxScore: true, percentage: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id: exam.id },
        data: { resultMaxScore: maxScore },
      });
      for (const attempt of attempts) {
        const previousMax = Number(attempt.maxScore ?? 0);
        const percentage =
          attempt.percentage === null
            ? previousMax
              ? (Number(attempt.score ?? 0) / previousMax) * 100
              : 0
            : Number(attempt.percentage);
        const scaledScore = this.roundScore((percentage / 100) * maxScore);
        await tx.examAttempt.update({
          where: { id: attempt.id },
          data: {
            score: scaledScore,
            maxScore,
            percentage: this.roundPercentage(percentage),
          },
        });
      }
    });

    return { examId, maxScore, updatedAttempts: attempts.length };
  }

  async updateAttemptScore(
    user: AuthUser,
    examId: string,
    attemptId: string,
    score: number,
  ) {
    const exam = await this.requireManagedExam(user, examId);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, examId, status: AttemptStatus.GRADED },
      select: { id: true, maxScore: true },
    });
    if (!attempt) throw new NotFoundException('Graded attempt not found');
    const maxScore = Number(attempt.maxScore ?? exam.resultMaxScore ?? 0);
    if (!maxScore) {
      throw new BadRequestException('The exam result has no maximum score');
    }
    if (score > maxScore) {
      throw new BadRequestException(`Score must be between 0 and ${maxScore}`);
    }
    return this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: {
        score: this.roundScore(score),
        maxScore,
        percentage: this.roundPercentage((score / maxScore) * 100),
        aiReport: Prisma.DbNull,
        gradedAt: new Date(),
      },
      select: {
        id: true,
        score: true,
        maxScore: true,
        percentage: true,
        gradedAt: true,
      },
    });
  }

  async createStudentScore(
    user: AuthUser,
    examId: string,
    studentId: string,
    score: number,
  ) {
    const exam = await this.requireManagedExam(user, examId);
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        id: studentId,
        organizationId: user.organizationId,
        enrollments: { some: { classroomId: exam.classroomId } },
      },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student is not in this class');

    const [existingAttempt, otherResult, items] = await Promise.all([
      this.prisma.examAttempt.findFirst({
        where: { examId, studentId },
        orderBy: { attemptNumber: 'desc' },
      }),
      this.prisma.examAttempt.findFirst({
        where: {
          examId,
          status: AttemptStatus.GRADED,
          maxScore: { not: null },
        },
        select: { maxScore: true },
        orderBy: { gradedAt: 'desc' },
      }),
      this.prisma.examItem.findMany({
        where: { examId },
        select: { score: true },
        orderBy: { position: 'asc' },
        take: exam.questionCount,
      }),
    ]);
    if (existingAttempt?.status === AttemptStatus.GRADED) {
      throw new BadRequestException('The student already has an exam result');
    }
    const maxScore = Number(
      exam.resultMaxScore ??
        otherResult?.maxScore ??
        items.reduce((sum, item) => sum + Number(item.score), 0),
    );
    if (!maxScore) {
      throw new BadRequestException('The exam result has no maximum score');
    }
    if (score > maxScore) {
      throw new BadRequestException(`Score must be between 0 and ${maxScore}`);
    }
    const now = new Date();
    const data = {
      status: AttemptStatus.GRADED,
      score: this.roundScore(score),
      maxScore,
      percentage: this.roundPercentage((score / maxScore) * 100),
      aiReport: Prisma.DbNull,
      submittedAt: now,
      gradedAt: now,
      lockedAt: null,
      lockReason: null,
    };
    if (existingAttempt) {
      return this.prisma.examAttempt.update({
        where: { id: existingAttempt.id },
        data,
      });
    }
    return this.prisma.examAttempt.create({
      data: {
        examId,
        studentId,
        attemptNumber: 1,
        startedAt: now,
        ...data,
      },
    });
  }

  async resetAttempt(user: AuthUser, examId: string, attemptId: string) {
    const exam = await this.requireManagedExam(user, examId);
    const selectedAttempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, examId },
      select: { studentId: true },
    });
    if (!selectedAttempt) throw new NotFoundException('Attempt not found');

    const attemptsToDelete = await this.prisma.examAttempt.findMany({
      where: { examId, studentId: selectedAttempt.studentId },
      include: {
        answers: {
          include: { question: { select: { indicatorId: true } } },
          orderBy: { answeredAt: 'asc' },
        },
      },
      orderBy: { attemptNumber: 'asc' },
    });
    const [student, resetBy] = await Promise.all([
      this.prisma.studentProfile.findUnique({
        where: { id: selectedAttempt.studentId },
        select: {
          studentCode: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!student) throw new NotFoundException('Student not found');

    const indicatorIds = [
      ...new Set(
        attemptsToDelete
          .flatMap((attempt) => attempt.answers)
          .map((answer) => answer.question.indicatorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const snapshot = JSON.parse(
      JSON.stringify({
        attempts: attemptsToDelete.map(({ answers, ...attempt }) => ({
          ...attempt,
          answers: answers.map(({ question, ...answer }) => {
            void question;
            return answer;
          }),
        })),
      }),
    ) as Prisma.InputJsonValue;

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      await tx.examAttemptResetArchive.create({
        data: {
          organizationId: exam.organizationId,
          examId,
          examCreatedById: exam.createdById,
          studentId: selectedAttempt.studentId,
          resetById: user.sub,
          resetByName: resetBy
            ? `${resetBy.firstName} ${resetBy.lastName}`.trim()
            : user.sub,
          examTitle: exam.title,
          studentCode: student.studentCode,
          studentName:
            `${student.user.firstName} ${student.user.lastName}`.trim(),
          attemptCount: attemptsToDelete.length,
          snapshot,
        },
      });
      const deleted = await tx.examAttempt.deleteMany({
        where: { examId, studentId: selectedAttempt.studentId },
      });

      await this.rebuildMastery(tx, selectedAttempt.studentId, indicatorIds);
      return deleted.count;
    });

    return {
      examId,
      studentId: selectedAttempt.studentId,
      deletedAttempts: deletedCount,
    };
  }

  async resetAttempts(user: AuthUser) {
    return this.prisma.examAttemptResetArchive.findMany({
      where: {
        organizationId: user.organizationId,
        restoredAt: null,
        ...(user.role === UserRole.TEACHER
          ? { examCreatedById: user.sub }
          : {}),
      },
      select: {
        id: true,
        examId: true,
        studentId: true,
        resetByName: true,
        examTitle: true,
        studentCode: true,
        studentName: true,
        attemptCount: true,
        resetAt: true,
      },
      orderBy: { resetAt: 'desc' },
    });
  }

  async restoreResetAttempt(user: AuthUser, archiveId: string) {
    const archive = await this.prisma.examAttemptResetArchive.findFirst({
      where: {
        id: archiveId,
        organizationId: user.organizationId,
        restoredAt: null,
        ...(user.role === UserRole.TEACHER
          ? { examCreatedById: user.sub }
          : {}),
      },
    });
    if (!archive) throw new NotFoundException('Reset result not found');
    await this.requireManagedExam(user, archive.examId);

    const snapshot = archive.snapshot as unknown as ResetAttemptSnapshot;
    if (!Array.isArray(snapshot?.attempts) || !snapshot.attempts.length) {
      throw new BadRequestException('Reset snapshot is invalid');
    }
    if (
      snapshot.attempts.some(
        (attempt) =>
          attempt.examId !== archive.examId ||
          attempt.studentId !== archive.studentId,
      )
    ) {
      throw new BadRequestException(
        'Reset snapshot does not match this result',
      );
    }

    const replacementCount = await this.prisma.examAttempt.count({
      where: { examId: archive.examId, studentId: archive.studentId },
    });
    if (replacementCount) {
      throw new BadRequestException(
        'The student already has a new attempt; remove it before restoring this result',
      );
    }

    const questionIds = [
      ...new Set(
        snapshot.attempts.flatMap((attempt) =>
          attempt.answers.map((answer) => answer.questionId),
        ),
      ),
    ];
    const questions = questionIds.length
      ? await this.prisma.question.findMany({
          where: { id: { in: questionIds } },
          select: { id: true, indicatorId: true },
        })
      : [];
    if (questions.length !== questionIds.length) {
      throw new BadRequestException(
        'One or more questions in this result no longer exist',
      );
    }
    const indicatorIds = [
      ...new Set(
        questions
          .map((question) => question.indicatorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    await this.prisma.$transaction(async (tx) => {
      for (const attempt of snapshot.attempts) {
        await tx.examAttempt.create({
          data: {
            id: attempt.id,
            examId: attempt.examId,
            studentId: attempt.studentId,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            currentDifficulty: attempt.currentDifficulty,
            correctStreak: attempt.correctStreak,
            incorrectStreak: attempt.incorrectStreak,
            score: attempt.score,
            maxScore: attempt.maxScore,
            percentage: attempt.percentage,
            aiReport:
              attempt.aiReport === null
                ? undefined
                : (attempt.aiReport as Prisma.InputJsonValue),
            lockedAt: attempt.lockedAt ? new Date(attempt.lockedAt) : null,
            lockReason: attempt.lockReason,
            violationCount: attempt.violationCount,
            lastViolationAt: attempt.lastViolationAt
              ? new Date(attempt.lastViolationAt)
              : null,
            startedAt: new Date(attempt.startedAt),
            submittedAt: attempt.submittedAt
              ? new Date(attempt.submittedAt)
              : null,
            gradedAt: attempt.gradedAt ? new Date(attempt.gradedAt) : null,
            answers: {
              create: attempt.answers.map((answer) => ({
                id: answer.id,
                questionId: answer.questionId,
                response: answer.response as Prisma.InputJsonValue,
                score: answer.score,
                isCorrect: answer.isCorrect,
                aiFeedback: answer.aiFeedback,
                aiConfidence: answer.aiConfidence,
                answeredAt: new Date(answer.answeredAt),
                gradedAt: answer.gradedAt ? new Date(answer.gradedAt) : null,
              })),
            },
          },
        });
      }
      await this.rebuildMastery(tx, archive.studentId, indicatorIds);
      await tx.examAttemptResetArchive.update({
        where: { id: archive.id },
        data: { restoredAt: new Date(), restoredById: user.sub },
      });
    });

    return {
      id: archive.id,
      examId: archive.examId,
      studentId: archive.studentId,
      restoredAttempts: snapshot.attempts.length,
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

    const answeredIds = new Set(
      attempt.answers.map((answer) => answer.questionId),
    );
    const planned = this.plannedItems(attempt);
    const remaining = planned.filter(
      (item) => !answeredIds.has(item.questionId),
    );
    if (!remaining.length) return null;
    const item = remaining[0];

    return {
      id: item.question.id,
      type: item.question.type,
      difficulty: item.question.difficulty,
      prompt: item.question.prompt,
      imageUrl: item.question.imageUrl,
      options: item.question.options,
      score: item.score,
      position: item.position,
      progress: {
        answered: attempt.answers.length,
        total: attempt.exam.questionCount,
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
    const answeredIds = new Set(
      attempt.answers.map((answer) => answer.questionId),
    );
    const currentItem = this.plannedItems(attempt).find(
      (plannedItem) => !answeredIds.has(plannedItem.questionId),
    );
    if (currentItem?.questionId !== questionId)
      throw new BadRequestException('Question is not current for this attempt');

    const usesAi = item.question.type === QuestionType.ESSAY;
    const studentAiEnabled = usesAi
      ? await this.ai.isStudentAiEnabled(user.organizationId)
      : false;
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
          aiFeedback: usesAi && studentAiEnabled ? grade.feedback : null,
          aiConfidence: usesAi ? grade.confidence : null,
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
      answer: { ...answer, feedback: grade.feedback },
      adaptiveState: state,
      nextQuestion: await this.nextQuestion(user, attemptId),
    };
  }

  async submit(user: AuthUser, attemptId: string) {
    const attempt = await this.requireAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt has already been submitted');
    this.assertAttemptUnlocked(attempt);
    const rawScore = attempt.answers.reduce(
      (total, answer) => total + Number(answer.score ?? 0),
      0,
    );
    const rawMaxScore = this.plannedItems(attempt).reduce(
      (total, item) => total + Number(item.score),
      0,
    );
    const percentage = rawMaxScore ? (rawScore / rawMaxScore) * 100 : 0;
    const maxScore = Number(attempt.exam.resultMaxScore ?? rawMaxScore);
    const score = attempt.exam.resultMaxScore
      ? this.roundScore((percentage / 100) * maxScore)
      : rawScore;
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
          feedback:
            item?.question.type === QuestionType.ESSAY
              ? studentAiEnabled
                ? answer.aiFeedback
                : null
              : item
                ? item.question.explanation ||
                  (answer.isCorrect
                    ? 'คำตอบถูกต้อง'
                    : 'คำตอบยังไม่ถูกต้อง ลองทบทวนอีกครั้ง')
                : null,
          aiFeedback:
            item?.question.type === QuestionType.ESSAY && studentAiEnabled
              ? answer.aiFeedback
              : null,
          question: item
            ? {
                id: item.question.id,
                type: item.question.type,
                prompt: item.question.prompt,
                imageUrl: item.question.imageUrl,
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
    const feedback =
      question.explanation ||
      (isCorrect ? 'คำตอบถูกต้อง' : 'คำตอบยังไม่ถูกต้อง ลองทบทวนอีกครั้ง');
    return {
      score: isCorrect ? maxScore : 0,
      isCorrect,
      feedback,
      confidence: 1,
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

  private async rebuildMastery(
    tx: Prisma.TransactionClient,
    studentId: string,
    indicatorIds: string[],
  ) {
    if (!indicatorIds.length) return;
    await tx.studentMastery.deleteMany({
      where: { studentId, indicatorId: { in: indicatorIds } },
    });
    const answers = await tx.attemptAnswer.findMany({
      where: {
        attempt: { studentId },
        question: { indicatorId: { in: indicatorIds } },
      },
      select: {
        isCorrect: true,
        question: { select: { indicatorId: true, difficulty: true } },
      },
      orderBy: { answeredAt: 'asc' },
    });
    for (const answer of answers) {
      if (!answer.question.indicatorId || answer.isCorrect === null) continue;
      await this.updateMastery(
        tx,
        studentId,
        answer.question.indicatorId,
        answer.isCorrect,
        answer.question.difficulty,
      );
    }
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

  private async validateQuestionSelection(
    user: AuthUser,
    dto: Pick<
      CreateExamDto,
      | 'classroomId'
      | 'classroomIds'
      | 'subjectId'
      | 'items'
      | 'isAdaptive'
      | 'questionCount'
      | 'essayQuestionCount'
      | 'questionTypeCounts'
    >,
  ) {
    const classroomIds = this.classroomIds(dto);
    const [classrooms, questions] = await Promise.all([
      this.prisma.classroom.findMany({
        where: {
          id: { in: classroomIds },
          organizationId: user.organizationId,
          isActive: true,
          ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
        },
        select: { id: true },
      }),
      this.prisma.question.findMany({
        where: {
          id: { in: dto.items.map((item) => item.questionId) },
          organizationId: user.organizationId,
          subjectId: dto.subjectId,
          isActive: true,
        },
        select: { id: true, type: true },
      }),
    ]);
    if (classrooms.length !== classroomIds.length)
      throw new NotFoundException('One or more classrooms not found');
    if (
      questions.length !==
      new Set(dto.items.map((item) => item.questionId)).size
    )
      throw new BadRequestException('One or more questions are invalid');
    if (dto.questionCount > questions.length)
      throw new BadRequestException(
        'Question count cannot exceed the selected question pool',
      );
    if (dto.isAdaptive && questions.length <= dto.questionCount)
      throw new BadRequestException(
        'Adaptive exams require a question pool larger than the actual question count',
      );
    const typeCounts = this.typeCounts(dto.questionTypeCounts);
    if (typeCounts) {
      const total = Object.values(typeCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (total !== dto.questionCount)
        throw new BadRequestException(
          'Question type counts must add up to the actual question count',
        );
      for (const type of Object.values(QuestionType)) {
        const target = typeCounts[type] ?? 0;
        const available = questions.filter(
          (question) => question.type === type,
        ).length;
        if (target > available)
          throw new BadRequestException(
            `Not enough ${type} questions for the configured count`,
          );
      }
      return;
    }
    const essayCount = questions.filter(
      (question) => question.type === QuestionType.ESSAY,
    ).length;
    const assignedEssayCount = dto.essayQuestionCount ?? essayCount;
    if (assignedEssayCount > essayCount)
      throw new BadRequestException(
        'Random essay count cannot exceed the selected essay pool',
      );
    if (assignedEssayCount > dto.questionCount)
      throw new BadRequestException(
        'Essay count cannot exceed the actual question count',
      );
    const objectiveCount = questions.length - essayCount;
    if (dto.questionCount - assignedEssayCount > objectiveCount)
      throw new BadRequestException(
        'Not enough objective questions for the configured question count',
      );
  }

  private classroomIds(
    dto: Pick<CreateExamDto, 'classroomId' | 'classroomIds'>,
  ) {
    const ids = dto.classroomIds?.length
      ? dto.classroomIds
      : dto.classroomId
        ? [dto.classroomId]
        : [];
    if (!ids.length)
      throw new BadRequestException('At least one classroom is required');
    return [...new Set(ids)];
  }

  private plannedItems(
    attempt: Awaited<ReturnType<ExamsService['requireAttempt']>>,
  ) {
    const { exam } = attempt;
    const typeCounts = this.typeCounts(exam.questionTypeCounts);
    if (typeCounts) {
      const selected = Object.values(QuestionType).flatMap((type) => {
        const target = typeCounts[type] ?? 0;
        if (!target) return [];
        const pool = exam.items.filter((item) => item.question.type === type);
        const answeredIds = new Set(
          attempt.answers
            .map((answer) => answer.questionId)
            .filter((id) => pool.some((item) => item.questionId === id)),
        );
        const answered = pool.filter((item) =>
          answeredIds.has(item.questionId),
        );
        const remaining = pool
          .filter((item) => !answeredIds.has(item.questionId))
          .sort((a, b) => {
            const distance = exam.isAdaptive
              ? this.adaptive.distance(
                  a.question.difficulty,
                  attempt.currentDifficulty,
                ) -
                this.adaptive.distance(
                  b.question.difficulty,
                  attempt.currentDifficulty,
                )
              : 0;
            return (
              distance ||
              this.stableOrder(attempt.id, a.questionId) -
                this.stableOrder(attempt.id, b.questionId)
            );
          });
        return [
          ...answered,
          ...remaining.slice(0, Math.max(0, target - answered.length)),
        ];
      });
      if (exam.isAdaptive) return selected;
      return selected.sort(
        (a, b) =>
          this.stableOrder(attempt.id, a.questionId) -
          this.stableOrder(attempt.id, b.questionId),
      );
    }
    const essays = exam.items.filter(
      (item) => item.question.type === QuestionType.ESSAY,
    );
    const objective = exam.items.filter(
      (item) => item.question.type !== QuestionType.ESSAY,
    );
    const essayTarget = Math.min(
      exam.essayQuestionCount ?? essays.length,
      essays.length,
    );
    const objectiveTarget = Math.max(0, exam.questionCount - essayTarget);
    const answeredObjectiveIds = new Set(
      attempt.answers
        .map((answer) => answer.questionId)
        .filter((id) => objective.some((item) => item.questionId === id)),
    );
    const answeredObjective = objective.filter((item) =>
      answeredObjectiveIds.has(item.questionId),
    );
    const remainingObjective = objective
      .filter((item) => !answeredObjectiveIds.has(item.questionId))
      .sort((a, b) => {
        if (!exam.isAdaptive)
          return (
            this.stableOrder(attempt.id, a.questionId) -
            this.stableOrder(attempt.id, b.questionId)
          );
        const distance =
          this.adaptive.distance(
            a.question.difficulty,
            attempt.currentDifficulty,
          ) -
          this.adaptive.distance(
            b.question.difficulty,
            attempt.currentDifficulty,
          );
        return (
          distance ||
          this.stableOrder(attempt.id, a.questionId) -
            this.stableOrder(attempt.id, b.questionId)
        );
      });
    const selectedObjective = [
      ...answeredObjective,
      ...remainingObjective.slice(
        0,
        Math.max(0, objectiveTarget - answeredObjective.length),
      ),
    ];
    const selectedEssays = [...essays]
      .sort(
        (a, b) =>
          this.stableOrder(attempt.id, a.questionId) -
          this.stableOrder(attempt.id, b.questionId),
      )
      .slice(0, essayTarget);
    const selected = [...selectedObjective, ...selectedEssays];
    if (exam.isAdaptive) return selected;
    return selected.sort(
      (a, b) =>
        this.stableOrder(attempt.id, a.questionId) -
        this.stableOrder(attempt.id, b.questionId),
    );
  }

  private stableOrder(attemptId: string, questionId: string) {
    let value = 2166136261;
    for (const character of `${attemptId}:${questionId}`) {
      value ^= character.charCodeAt(0);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  private typeCounts(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const source = value as Record<string, unknown>;
    const result: Partial<Record<QuestionType, number>> = {};
    for (const [key, rawCount] of Object.entries(source)) {
      if (!Object.values(QuestionType).includes(key as QuestionType))
        throw new BadRequestException(`Unknown question type: ${key}`);
      const count = Number(rawCount);
      if (!Number.isInteger(count) || count < 0)
        throw new BadRequestException(
          'Question type counts must be non-negative integers',
        );
      result[key as QuestionType] = count;
    }
    return result;
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

  private roundScore(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private roundPercentage(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private clamp(value: unknown) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }
}
