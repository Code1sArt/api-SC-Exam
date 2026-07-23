import { Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, UserRole } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(user: AuthUser, classroomId?: string) {
    const classroomWhere = {
      organizationId: user.organizationId,
      isActive: true,
      ...(classroomId ? { id: classroomId } : {}),
      ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
    };
    const classrooms = await this.prisma.classroom.findMany({
      where: classroomWhere,
      select: { id: true },
    });
    const classroomIds = classrooms.map((item) => item.id);
    const [studentCount, questionCount, examCount, exams, students] =
      await Promise.all([
        this.prisma.studentProfile.count({
          where: {
            organizationId: user.organizationId,
            enrollments: { some: { classroomId: { in: classroomIds } } },
          },
        }),
        this.prisma.question.count({
          where: { organizationId: user.organizationId, isActive: true },
        }),
        this.prisma.exam.count({
          where: {
            organizationId: user.organizationId,
            classroomId: { in: classroomIds },
          },
        }),
        this.prisma.exam.findMany({
          where: {
            organizationId: user.organizationId,
            classroomId: { in: classroomIds },
          },
          include: {
            classroom: { select: { name: true } },
            subject: { select: { name: true } },
            attempts: {
              where: { status: AttemptStatus.GRADED },
              select: { percentage: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.studentProfile.findMany({
          where: {
            organizationId: user.organizationId,
            enrollments: { some: { classroomId: { in: classroomIds } } },
          },
          select: {
            id: true,
            studentCode: true,
            user: { select: { firstName: true, lastName: true } },
            attempts: {
              where: {
                status: AttemptStatus.GRADED,
                exam: { classroomId: { in: classroomIds } },
              },
              select: { percentage: true },
            },
          },
        }),
      ]);

    const grouped = students.map((student) => {
      const values = student.attempts.map((attempt) =>
        Number(attempt.percentage ?? 0),
      );
      const average = values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
      return {
        id: student.id,
        studentCode: student.studentCode,
        name: `${student.user.firstName} ${student.user.lastName}`,
        average,
        group:
          average === null
            ? 'NO_DATA'
            : average >= 80
              ? 'STRONG'
              : average >= 50
                ? 'AVERAGE'
                : 'NEEDS_SUPPORT',
      };
    });
    const groupCounts = grouped.reduce<Record<string, number>>(
      (counts, student) => {
        counts[student.group] = (counts[student.group] ?? 0) + 1;
        return counts;
      },
      {},
    );

    return {
      totals: {
        classrooms: classroomIds.length,
        students: studentCount,
        questions: questionCount,
        exams: examCount,
      },
      studentGroups: groupCounts,
      students: grouped,
      recentExams: exams.map((exam) => {
        const percentages = exam.attempts.map((a) => Number(a.percentage ?? 0));
        return {
          id: exam.id,
          title: exam.title,
          classroom: exam.classroom.name,
          subject: exam.subject.name,
          status: exam.status,
          submissions: percentages.length,
          average: percentages.length
            ? percentages.reduce((sum, value) => sum + value, 0) /
              percentages.length
            : null,
        };
      }),
    };
  }

  async examResults(user: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: {
        id: examId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
      include: {
        classroom: { select: { name: true } },
        subject: { select: { name: true } },
        attempts: {
          where: { status: AttemptStatus.GRADED },
          include: {
            student: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
            answers: {
              include: {
                question: {
                  select: { id: true, indicatorId: true, difficulty: true },
                },
              },
            },
          },
          orderBy: { percentage: 'desc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    const distribution = { strong: 0, average: 0, needsSupport: 0 };
    for (const attempt of exam.attempts) {
      const percentage = Number(attempt.percentage ?? 0);
      if (percentage >= 80) distribution.strong += 1;
      else if (percentage >= 50) distribution.average += 1;
      else distribution.needsSupport += 1;
    }
    const questionStats = new Map<string, { correct: number; total: number }>();
    for (const attempt of exam.attempts) {
      for (const answer of attempt.answers) {
        const stat = questionStats.get(answer.questionId) ?? {
          correct: 0,
          total: 0,
        };
        stat.total += 1;
        if (answer.isCorrect) stat.correct += 1;
        questionStats.set(answer.questionId, stat);
      }
    }

    return {
      id: exam.id,
      title: exam.title,
      classroom: exam.classroom.name,
      subject: exam.subject.name,
      distribution,
      students: exam.attempts.map((attempt) => ({
        attemptId: attempt.id,
        studentCode: attempt.student.studentCode,
        name: `${attempt.student.user.firstName} ${attempt.student.user.lastName}`,
        score: attempt.score,
        maxScore: attempt.maxScore,
        percentage: attempt.percentage,
        aiReport: attempt.aiReport,
      })),
      questions: Array.from(questionStats.entries()).map(
        ([questionId, value]) => ({
          questionId,
          ...value,
          correctRate: value.total ? value.correct / value.total : 0,
        }),
      ),
    };
  }

  async indicatorMastery(user: AuthUser, subjectId?: string) {
    const indicators = await this.prisma.indicator.findMany({
      where: { organizationId: user.organizationId, subjectId },
      include: {
        subject: { select: { name: true } },
        mastery: {
          select: { ability: true, correctRate: true, sampleSize: true },
        },
      },
      orderBy: { code: 'asc' },
    });
    return indicators.map((indicator) => {
      const measured = indicator.mastery.filter((item) => item.sampleSize > 0);
      return {
        id: indicator.id,
        code: indicator.code,
        description: indicator.description,
        subject: indicator.subject.name,
        measuredStudents: measured.length,
        averageCorrectRate: measured.length
          ? measured.reduce((sum, item) => sum + Number(item.correctRate), 0) /
            measured.length
          : null,
        averageAbility: measured.length
          ? measured.reduce((sum, item) => sum + Number(item.ability), 0) /
            measured.length
          : null,
      };
    });
  }
}
