import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  AttemptStatus,
  CodingGradingStatus,
  ExamStatus,
  UserRole,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { CodeRunnerService } from '../assignments/code-runner.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCodingTestDto,
  GradeCodingAttemptDto,
  RunCodingTestDto,
  SubmitCodingTestDto,
  UpdateCodingTestDto,
} from './dto/coding-test.dto';
import { calculateCodingScoreParts, clampScore } from './coding-grading';

@Injectable()
export class CodingTestsService implements OnModuleInit {
  private readonly activeGrades = new Set<string>();
  private readonly cancelledGrades = new Set<string>();
  private activeGradeCount = 0;
  private readonly gradingWaiters: Array<() => void> = [];
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly runner: CodeRunnerService,
  ) {}

  async onModuleInit() {
    const pending = await this.prisma.codingTestAttempt.findMany({
      where: {
        gradingStatus: {
          in: [CodingGradingStatus.QUEUED, CodingGradingStatus.GRADING],
        },
      },
      select: { id: true },
    });
    await this.prisma.codingTestAttempt.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { gradingStatus: CodingGradingStatus.QUEUED },
    });
    pending.forEach((row) => void this.processQueue(row.id));
  }

  async list(user: AuthUser) {
    if (user.role === UserRole.STUDENT) {
      const student = await this.student(user);
      const rows = await this.prisma.codingTest.findMany({
        where: {
          organizationId: user.organizationId,
          classroom: { enrollments: { some: { studentId: student.id } } },
          OR: [
            { status: ExamStatus.PUBLISHED },
            { attempts: { some: { studentId: student.id } } },
          ],
        },
        include: {
          classroom: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
          problems: { orderBy: { position: 'asc' } },
          attempts: {
            where: { studentId: student.id },
            include: {
              answers: {
                select: {
                  id: true,
                  problemId: true,
                  score: true,
                  feedback: true,
                },
              },
            },
          },
        },
        orderBy: { availableFrom: 'asc' },
      });
      return rows.map((row) => ({
        ...row,
        problems: row.problems.map((problem) => ({
          ...problem,
          previewUrl: this.previewUrl(problem.pdfUrl),
        })),
        attempts: row.attempts.map((attempt) => ({
          ...attempt,
          answers: attempt.answers.map((answer) => ({
            ...answer,
            feedback: this.studentFeedback(answer.feedback),
          })),
        })),
      }));
    }
    return this.prisma.codingTest.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
      include: {
        classroom: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        problems: {
          include: { testCases: { orderBy: { position: 'asc' } } },
          orderBy: { position: 'asc' },
        },
        attempts: {
          include: {
            student: {
              select: {
                studentCode: true,
                user: { select: { firstName: true, lastName: true } },
              },
            },
            answers: {
              include: { problem: { select: { title: true, score: true } } },
            },
          },
          orderBy: { submittedAt: 'desc' },
        },
        _count: { select: { attempts: true, problems: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: CreateCodingTestDto) {
    await this.validate(user, dto);
    return this.prisma.codingTest.create({
      data: {
        organizationId: user.organizationId,
        createdById: user.sub,
        classroomId: dto.classroomId,
        subjectId: dto.subjectId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        requiredCount: dto.requiredCount,
        fullScore: dto.fullScore,
        durationMinutes: dto.durationMinutes,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : null,
        availableUntil: dto.availableUntil
          ? new Date(dto.availableUntil)
          : null,
        aiGradingEnabled: dto.aiGradingEnabled ?? true,
        aiGradingModel:
          dto.aiGradingEnabled === false ? null : dto.aiGradingModel,
        problems: {
          create: dto.problems.map((problem, position) => ({
            title: problem.title.trim(),
            description: problem.description?.trim() || null,
            pdfUrl: problem.pdfUrl.trim(),
            language: problem.language,
            score: problem.score,
            position: position + 1,
            testCases: {
              create: problem.testCases.map((testCase, caseIndex) => ({
                input: testCase.input,
                expectedOutput: testCase.expectedOutput,
                position: caseIndex + 1,
              })),
            },
          })),
        },
      },
      include: { problems: { include: { testCases: true } } },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateCodingTestDto) {
    const current = await this.managed(user, id);
    if (
      dto.problems &&
      (await this.prisma.codingTestAttempt.count({
        where: { codingTestId: id },
      }))
    )
      throw new BadRequestException(
        'ไม่สามารถแก้ชุดโจทย์หลังมีนักเรียนเริ่มสอบแล้ว',
      );
    const merged = {
      classroomId: dto.classroomId ?? current.classroomId,
      subjectId: dto.subjectId ?? current.subjectId,
      requiredCount: dto.requiredCount ?? current.requiredCount,
      fullScore: dto.fullScore ?? current.fullScore,
      problems: dto.problems ?? current.problems,
    };
    await this.validate(user, merged);
    return this.prisma.$transaction(async (tx) => {
      if (dto.problems) {
        await tx.codingTestProblem.deleteMany({ where: { codingTestId: id } });
        for (const [position, problem] of dto.problems.entries())
          await tx.codingTestProblem.create({
            data: {
              codingTestId: id,
              title: problem.title.trim(),
              description: problem.description?.trim() || null,
              pdfUrl: problem.pdfUrl.trim(),
              language: problem.language,
              score: problem.score,
              position: position + 1,
              testCases: {
                create: problem.testCases.map((testCase, caseIndex) => ({
                  input: testCase.input,
                  expectedOutput: testCase.expectedOutput,
                  position: caseIndex + 1,
                })),
              },
            },
          });
      }
      return tx.codingTest.update({
        where: { id },
        data: {
          classroomId: dto.classroomId,
          subjectId: dto.subjectId,
          title: dto.title?.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description.trim() || null,
          requiredCount: dto.requiredCount,
          fullScore: dto.fullScore,
          durationMinutes: dto.durationMinutes,
          availableFrom: dto.availableFrom
            ? new Date(dto.availableFrom)
            : dto.availableFrom === null
              ? null
              : undefined,
          availableUntil: dto.availableUntil
            ? new Date(dto.availableUntil)
            : dto.availableUntil === null
              ? null
              : undefined,
          aiGradingEnabled: dto.aiGradingEnabled,
          aiGradingModel:
            dto.aiGradingEnabled === false ? null : dto.aiGradingModel,
        },
      });
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.managed(user, id);
    if (
      await this.prisma.codingTestAttempt.count({ where: { codingTestId: id } })
    )
      throw new BadRequestException(
        'ไม่สามารถลบ Coding Test ที่มีผู้เข้าสอบแล้ว',
      );
    await this.prisma.codingTest.delete({ where: { id } });
    return { deleted: true, id };
  }
  async resetAttempt(user: AuthUser, testId: string, attemptId: string) {
    await this.managed(user, testId);
    const attempt = await this.prisma.codingTestAttempt.findFirst({
      where: { id: attemptId, codingTestId: testId },
    });
    if (!attempt) throw new NotFoundException('Coding attempt not found');
    this.cancelledGrades.add(attemptId);
    await this.prisma.codingTestAttempt.delete({ where: { id: attemptId } });
    return { id: attemptId, deleted: true };
  }
  async setAvailability(user: AuthUser, id: string, isOpen: boolean) {
    const test = await this.managed(user, id);
    if (isOpen && test.problems.some((problem) => !problem.testCases.length))
      throw new BadRequestException('โจทย์ทุกข้อต้องมี test case ก่อนเปิดสอบ');
    return this.prisma.codingTest.update({
      where: { id },
      data: { status: isOpen ? ExamStatus.PUBLISHED : ExamStatus.CLOSED },
    });
  }

  async start(user: AuthUser, id: string) {
    const student = await this.student(user);
    const test = await this.prisma.codingTest.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        classroom: { enrollments: { some: { studentId: student.id } } },
      },
      include: {
        problems: { orderBy: { position: 'asc' } },
        attempts: { where: { studentId: student.id } },
      },
    });
    if (!test) throw new NotFoundException('Coding Test not found');
    const existing = test.attempts[0];
    if (existing)
      return {
        attempt: existing,
        problems: test.problems.map((p) => ({
          ...p,
          previewUrl: this.previewUrl(p.pdfUrl),
        })),
      };
    const now = new Date();
    if (
      test.status !== ExamStatus.PUBLISHED ||
      (test.availableFrom && now < test.availableFrom) ||
      (test.availableUntil && now > test.availableUntil)
    )
      throw new BadRequestException('Coding Test ยังไม่เปิดให้ทำ');
    const attempt = await this.prisma.codingTestAttempt.create({
      data: { codingTestId: id, studentId: student.id },
    });
    return {
      attempt,
      problems: test.problems.map((p) => ({
        ...p,
        previewUrl: this.previewUrl(p.pdfUrl),
      })),
    };
  }

  async submit(user: AuthUser, attemptId: string, dto: SubmitCodingTestDto) {
    const attempt = await this.studentAttempt(user, attemptId);
    this.assertUnlocked(attempt);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('ส่ง Coding Test นี้แล้ว');
    const unique = new Set(dto.answers.map((answer) => answer.problemId));
    if (
      unique.size !== dto.answers.length ||
      dto.answers.length < attempt.codingTest.requiredCount
    )
      throw new BadRequestException(
        `ต้องทำและส่งอย่างน้อย ${attempt.codingTest.requiredCount} ข้อ`,
      );
    const problems = attempt.codingTest.problems.filter((p) =>
      unique.has(p.id),
    );
    if (problems.length !== dto.answers.length)
      throw new BadRequestException('มีโจทย์ที่ไม่อยู่ใน Coding Test นี้');
    if (problems.some((problem) => !problem.testCases.length))
      throw new BadRequestException(
        'โจทย์ยังไม่มี test case กรุณาแจ้งครูผู้สอน',
      );
    const maxScore = Number(attempt.codingTest.fullScore);
    const queued = attempt.codingTest.aiGradingEnabled;
    await this.prisma.$transaction(async (tx) => {
      await tx.codingTestAnswer.createMany({
        data: dto.answers.map((answer) => ({
          attemptId,
          problemId: answer.problemId,
          sourceCode: answer.sourceCode.trim(),
        })),
      });
      await tx.codingTestAttempt.update({
        where: { id: attemptId },
        data: {
          status: AttemptStatus.SUBMITTED,
          gradingStatus: queued ? CodingGradingStatus.QUEUED : null,
          maxScore,
          submittedAt: new Date(),
        },
      });
    });
    if (queued) void this.processQueue(attemptId);
    return this.status(user, attemptId);
  }

  async status(user: AuthUser, attemptId: string) {
    const where =
      user.role === UserRole.STUDENT
        ? {
            id: attemptId,
            student: { userId: user.sub },
            codingTest: { organizationId: user.organizationId },
          }
        : {
            id: attemptId,
            codingTest: {
              organizationId: user.organizationId,
              ...(user.role === UserRole.TEACHER
                ? { createdById: user.sub }
                : {}),
            },
          };
    const attempt = await this.prisma.codingTestAttempt.findFirst({
      where,
      include: {
        answers: {
          include: { problem: { select: { title: true, score: true } } },
        },
        codingTest: {
          select: {
            id: true,
            title: true,
            requiredCount: true,
            fullScore: true,
            aiGradingEnabled: true,
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Coding attempt not found');
    if (user.role !== UserRole.STUDENT) return attempt;
    return {
      ...attempt,
      answers: attempt.answers.map(({ testResults, ...answer }) => {
        void testResults;
        return {
          ...answer,
          feedback: this.studentFeedback(answer.feedback),
        };
      }),
    };
  }

  async reportViolation(user: AuthUser, attemptId: string, type: string) {
    const attempt = await this.studentAttempt(user, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new BadRequestException('Attempt is not in progress');
    const now = new Date();
    return this.prisma.codingTestAttempt.update({
      where: { id: attemptId },
      data: {
        lockedAt: attempt.lockedAt ?? now,
        lockReason: attempt.lockReason ?? type,
        violationCount: { increment: 1 },
        lastViolationAt: now,
      },
    });
  }
  async unlock(user: AuthUser, attemptId: string) {
    const attempt = await this.status(user, attemptId);
    return this.prisma.codingTestAttempt.update({
      where: { id: attempt.id },
      data: { lockedAt: null, lockReason: null },
    });
  }
  async run(user: AuthUser, id: string, dto: RunCodingTestDto) {
    const student = await this.student(user);
    const attempt = await this.prisma.codingTestAttempt.findFirst({
      where: {
        codingTestId: id,
        studentId: student.id,
        status: AttemptStatus.IN_PROGRESS,
      },
      include: { codingTest: { include: { problems: true } } },
    });
    if (!attempt) throw new NotFoundException('Coding attempt not found');
    this.assertUnlocked(attempt);
    const problem = attempt.codingTest.problems.find(
      (p) => p.id === dto.problemId,
    );
    if (!problem) throw new BadRequestException('โจทย์ไม่ถูกต้อง');
    return this.runner.run(problem.language, dto.sourceCode, dto.stdin);
  }

  async grade(user: AuthUser, attemptId: string, dto: GradeCodingAttemptDto) {
    const attempt = await this.status(user, attemptId);
    const answerMap = new Map(
      attempt.answers.map((answer) => [answer.id, answer]),
    );
    if (dto.answers.length !== attempt.answers.length)
      throw new BadRequestException('กรุณาให้คะแนนทุกข้อที่ส่ง');
    let rawScore = 0;
    const rawMaxScore = attempt.answers.reduce(
      (sum, answer) => sum + Number(answer.problem.score),
      0,
    );
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.answers) {
        const answer = answerMap.get(item.answerId);
        if (!answer || item.score > Number(answer.problem.score))
          throw new BadRequestException('คะแนนรายข้อไม่ถูกต้อง');
        rawScore += item.score;
        await tx.codingTestAnswer.update({
          where: { id: item.answerId },
          data: {
            score: item.score,
            feedback: item.feedback,
            gradedAt: new Date(),
          },
        });
      }
      await tx.codingTestAttempt.update({
        where: { id: attemptId },
        data: {
          status: AttemptStatus.GRADED,
          gradingStatus: CodingGradingStatus.GRADED,
          score: rawMaxScore
            ? (rawScore / rawMaxScore) * Number(attempt.codingTest.fullScore)
            : 0,
          percentage: rawMaxScore
            ? (rawScore / rawMaxScore) * 100
            : 0,
          gradedAt: new Date(),
          gradingError: null,
        },
      });
    });
    return this.status(user, attemptId);
  }

  private async processQueue(attemptId: string) {
    if (this.activeGrades.has(attemptId)) return;
    this.activeGrades.add(attemptId);
    const release = await this.acquireGradeSlot();
    try {
      if (this.cancelledGrades.has(attemptId)) return;
      const attempt = await this.prisma.codingTestAttempt.update({
        where: { id: attemptId },
        data: { gradingStatus: CodingGradingStatus.GRADING },
        include: {
          codingTest: true,
          student: { select: { userId: true } },
          answers: {
            include: {
              problem: {
                include: { testCases: { orderBy: { position: 'asc' } } },
              },
            },
          },
        },
      });
      let rawScore = 0;
      const rawMaxScore = attempt.answers.reduce(
        (sum, answer) => sum + Number(answer.problem.score),
        0,
      );
      for (const answer of attempt.answers) {
        const testResults = [];
        for (const testCase of answer.problem.testCases) {
          if (this.cancelledGrades.has(attemptId))
            throw new Error('Attempt reset');
          const execution = await this.runner.run(
            answer.problem.language,
            answer.sourceCode,
            testCase.input,
          );
          const actualOutput =
            execution.stdout ||
            execution.stderr ||
            execution.compileOutput ||
            execution.message;
          const passed =
            execution.statusId === 3 &&
            this.normalizeOutput(actualOutput) ===
              this.normalizeOutput(testCase.expectedOutput);
          testResults.push({
            position: testCase.position,
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
            actualOutput,
            status: execution.status,
            passed,
          });
        }
        const passedCount = testResults.filter((item) => item.passed).length;
        const { testCaseScore, testCaseMaxScore, aiReviewMaxScore } =
          calculateCodingScoreParts(
            Number(answer.problem.score),
            passedCount,
            testResults.length,
          );
        const evidence = testResults
          .map(
            (item) =>
              `Test ${item.position}: ${item.passed ? 'PASS' : 'FAIL'}\nInput: ${item.input}\nExpected: ${item.expectedOutput}\nActual: ${item.actualOutput}`,
          )
          .join('\n\n');
        const result = await this.ai.gradeCode(
          {
            organizationId: attempt.codingTest.organizationId,
            requestedById: attempt.student.userId,
          },
          {
            assignment: `${answer.problem.title}\n${answer.problem.description ?? ''}\n\nผลรัน test case จริง (${passedCount}/${testResults.length} ผ่าน):\n${evidence}\n\nให้ประเมินเฉพาะส่วนโครงสร้างและอัลกอริทึม คะแนนเต็ม ${aiReviewMaxScore} คะแนน แยกจากคะแนน test case ที่ระบบคำนวณแล้ว ${testCaseScore}/${testCaseMaxScore} คะแนน\nเกณฑ์ของส่วนนี้: ความถูกต้องของแนวคิดและอัลกอริทึม 2 ใน 3 และโครงสร้างลำดับการทำงาน เงื่อนไข ลูป และโครงสร้างข้อมูล 1 ใน 3\nห้ามให้หรือตัดคะแนนจากความสวยงาม การจัด format การตั้งชื่อตัวแปร ความยาวโค้ด comment หรือ coding style หากสิ่งเหล่านั้นไม่ทำให้โปรแกรมทำงานผิด\nหากแนวคิดถูกแต่ output ไม่ตรงแบบ exact เช่น พิมพ์คำอธิบายหรือข้อความเพิ่ม ให้คะแนนบางส่วนได้ แต่ไม่ควรได้เต็มส่วนโครงสร้างและอัลกอริทึม`,
            language: answer.problem.language,
            sourceCode: answer.sourceCode,
            maxScore: aiReviewMaxScore,
          },
          attempt.codingTest.aiGradingModel,
        );
        const aiReviewScore = clampScore(result.score, aiReviewMaxScore);
        const itemScore = Math.min(
          Number(answer.problem.score),
          testCaseScore + aiReviewScore,
        );
        rawScore += itemScore;
        await this.prisma.codingTestAnswer.update({
          where: { id: answer.id },
          data: {
            score: itemScore,
            feedback: `ผล Test case ${passedCount}/${testResults.length} ชุด — ${testCaseScore.toFixed(2)}/${testCaseMaxScore.toFixed(2)} คะแนน\nโครงสร้างและอัลกอริทึม — ${aiReviewScore.toFixed(2)}/${aiReviewMaxScore.toFixed(2)} คะแนน\n${result.feedback}`,
            aiConfidence: result.confidence,
            passedTestCases: passedCount,
            totalTestCases: testResults.length,
            testResults,
            gradedAt: new Date(),
          },
        });
      }
      await this.prisma.codingTestAttempt.update({
        where: { id: attemptId },
        data: {
          status: AttemptStatus.GRADED,
          gradingStatus: CodingGradingStatus.GRADED,
          score: rawMaxScore
            ? (rawScore / rawMaxScore) * Number(attempt.codingTest.fullScore)
            : 0,
          percentage: attempt.maxScore
            ? ((rawScore / rawMaxScore) * Number(attempt.codingTest.fullScore) /
                Number(attempt.maxScore)) *
              100
            : 0,
          gradedAt: new Date(),
          gradingError: null,
        },
      });
    } catch (error) {
      await this.prisma.codingTestAttempt
        .update({
          where: { id: attemptId },
          data: {
            gradingStatus: CodingGradingStatus.FAILED,
            gradingError:
              error instanceof Error
                ? error.message.slice(0, 2000)
                : 'Unknown grading error',
          },
        })
        .catch(() => undefined);
    } finally {
      this.activeGrades.delete(attemptId);
      this.cancelledGrades.delete(attemptId);
      release();
    }
  }

  private async acquireGradeSlot() {
    if (this.activeGradeCount < 2) {
      this.activeGradeCount += 1;
      return () => this.releaseGradeSlot();
    }
    await new Promise<void>((resolve) => this.gradingWaiters.push(resolve));
    return () => this.releaseGradeSlot();
  }
  private releaseGradeSlot() {
    const next = this.gradingWaiters.shift();
    if (next) next();
    else this.activeGradeCount -= 1;
  }

  private async validate(
    user: AuthUser,
    dto: {
      classroomId: string;
      subjectId: string;
      requiredCount: number;
      problems: Array<{ pdfUrl: string; testCases: unknown[] }>;
    },
  ) {
    if (dto.requiredCount > dto.problems.length)
      throw new BadRequestException(
        'จำนวนข้อขั้นต่ำต้องไม่เกินจำนวนโจทย์ทั้งหมด',
      );
    dto.problems.forEach((problem) => {
      this.previewUrl(problem.pdfUrl);
      if (!problem.testCases?.length)
        throw new BadRequestException(
          'โจทย์ทุกข้อต้องมี test case อย่างน้อย 1 ชุด',
        );
    });
    const [classroom, subject] = await Promise.all([
      this.prisma.classroom.findFirst({
        where: {
          id: dto.classroomId,
          organizationId: user.organizationId,
          ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
        },
      }),
      this.prisma.subject.findFirst({
        where: { id: dto.subjectId, organizationId: user.organizationId },
      }),
    ]);
    if (!classroom || !subject)
      throw new ForbiddenException('ห้องเรียนหรือวิชาไม่ถูกต้อง');
  }
  private async managed(user: AuthUser, id: string) {
    const row = await this.prisma.codingTest.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
      include: {
        problems: { include: { testCases: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!row) throw new NotFoundException('Coding Test not found');
    return row;
  }
  private async student(user: AuthUser) {
    const row = await this.prisma.studentProfile.findFirst({
      where: { userId: user.sub, organizationId: user.organizationId },
    });
    if (!row) throw new ForbiddenException('Student profile not found');
    return row;
  }
  private async studentAttempt(user: AuthUser, id: string) {
    const student = await this.student(user);
    const row = await this.prisma.codingTestAttempt.findFirst({
      where: {
        id,
        studentId: student.id,
        codingTest: { organizationId: user.organizationId },
      },
      include: {
        codingTest: { include: { problems: { include: { testCases: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Coding attempt not found');
    return row;
  }
  private assertUnlocked(attempt: {
    lockedAt: Date | null;
    lockReason: string | null;
  }) {
    if (attempt.lockedAt)
      throw new HttpException(
        {
          message: 'Coding attempt is locked',
          lockReason: attempt.lockReason,
          lockedAt: attempt.lockedAt,
        },
        HttpStatus.LOCKED,
      );
  }
  private normalizeOutput(value: string) {
    return value
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  }
  private studentFeedback(value: string | null) {
    if (!value) return value;
    return value
      .replace(/วิเคราะห์โค้ดโดย\s*AI/gi, 'โครงสร้างและอัลกอริทึม')
      .replace(/คุณภาพโค้ด/g, 'โครงสร้างและอัลกอริทึม')
      .replace(/\bAI\b/gi, 'ระบบประเมิน');
  }
  private previewUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('ลิงก์โจทย์ไม่ถูกต้อง');
    }
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname))
      throw new BadRequestException(
        'รองรับลิงก์โจทย์จาก Google Drive เท่านั้น',
      );
    const match = url.pathname.match(
      /\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/]+)/,
    );
    const id = match?.[1] ?? url.searchParams.get('id');
    if (!id) throw new BadRequestException('ไม่พบรหัสไฟล์ Google Drive');
    if (url.pathname.includes('/document/'))
      return `https://docs.google.com/document/d/${id}/preview`;
    if (url.pathname.includes('/spreadsheets/'))
      return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    if (url.pathname.includes('/presentation/'))
      return `https://docs.google.com/presentation/d/${id}/embed`;
    return `https://drive.google.com/file/d/${id}/preview`;
  }
}
