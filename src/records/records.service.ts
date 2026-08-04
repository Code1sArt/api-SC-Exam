import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttemptStatus, SubmissionStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_GRADES = { A: 80, B: 70, C: 60, D: 50, F: 0 };

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(user: AuthUser) {
    const student = await this.prisma.studentProfile.findFirst({
      where: { userId: user.sub, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found');

    const [attempts, codingAttempts, submissions, gradeRows] =
      await Promise.all([
        this.prisma.examAttempt.findMany({
          where: {
            studentId: student.id,
            status: AttemptStatus.GRADED,
            exam: { organizationId: user.organizationId },
          },
          select: {
            id: true,
            examId: true,
            score: true,
            maxScore: true,
            percentage: true,
            gradedAt: true,
            exam: {
              select: {
                title: true,
                classroom: {
                  select: {
                    id: true,
                    name: true,
                    gradeLevel: true,
                    academicYear: true,
                  },
                },
                subject: { select: { id: true, code: true, name: true } },
              },
            },
          },
        }),
        this.prisma.codingTestAttempt.findMany({
          where: {
            studentId: student.id,
            status: AttemptStatus.GRADED,
            codingTest: { organizationId: user.organizationId },
          },
          select: {
            id: true,
            score: true,
            maxScore: true,
            gradedAt: true,
            codingTest: {
              select: {
                title: true,
                classroom: {
                  select: {
                    id: true,
                    name: true,
                    gradeLevel: true,
                    academicYear: true,
                  },
                },
                subject: { select: { id: true, code: true, name: true } },
              },
            },
          },
        }),
        this.prisma.assignmentSubmission.findMany({
          where: {
            OR: [
              { studentId: student.id },
              { members: { some: { studentId: student.id } } },
            ],
            status: SubmissionStatus.GRADED,
            assignment: { organizationId: user.organizationId },
          },
          select: {
            id: true,
            score: true,
            members: {
              where: { studentId: student.id },
              select: { score: true },
            },
            gradedAt: true,
            assignment: {
              select: {
                title: true,
                maxScore: true,
                classroom: {
                  select: {
                    id: true,
                    name: true,
                    gradeLevel: true,
                    academicYear: true,
                  },
                },
                subject: { select: { id: true, code: true, name: true } },
              },
            },
          },
        }),
        this.prisma.gradeScale.findMany({
          where: { organizationId: user.organizationId },
          orderBy: { minPercentage: 'desc' },
        }),
      ]);
    const scale = gradeRows.length
      ? gradeRows.map((row) => [row.grade, Number(row.minPercentage)] as const)
      : Object.entries(DEFAULT_GRADES);
    const groups = new Map<string, RecordRow>();
    const get = (classroom: Classroom, subject: Subject) => {
      const key = `${classroom.id}:${subject.id}`;
      const current = groups.get(key);
      if (current) return current;
      const created: RecordRow = {
        classroom,
        subject,
        exams: [],
        assignments: [],
      };
      groups.set(key, created);
      return created;
    };
    // Multiple attempts for the same exam count once, using the student's best score.
    const bestAttempts = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      const previous = bestAttempts.get(attempt.examId);
      if (
        !previous ||
        Number(attempt.percentage ?? 0) > Number(previous.percentage ?? 0)
      )
        bestAttempts.set(attempt.examId, attempt);
    }
    for (const attempt of bestAttempts.values()) {
      const row = get(attempt.exam.classroom, attempt.exam.subject);
      row.exams.push({
        id: attempt.id,
        title: attempt.exam.title,
        score: Number(attempt.score ?? 0),
        maxScore: Number(attempt.maxScore ?? 0),
        gradedAt: attempt.gradedAt,
      });
    }
    for (const attempt of codingAttempts) {
      const row = get(attempt.codingTest.classroom, attempt.codingTest.subject);
      row.exams.push({
        id: attempt.id,
        title: `${attempt.codingTest.title} · Coding Test`,
        score: Number(attempt.score ?? 0),
        maxScore: Number(attempt.maxScore ?? 0),
        gradedAt: attempt.gradedAt,
      });
    }
    for (const submission of submissions) {
      const row = get(
        submission.assignment.classroom,
        submission.assignment.subject,
      );
      row.assignments.push({
        id: submission.id,
        title: submission.assignment.title,
        score: Number(submission.members[0]?.score ?? submission.score ?? 0),
        maxScore: Number(submission.assignment.maxScore),
        gradedAt: submission.gradedAt,
      });
    }
    const subjects = [...groups.values()].map((row) => {
      const assessments = [...row.exams, ...row.assignments];
      const score = assessments.reduce((sum, item) => sum + item.score, 0);
      // A subject is always graded out of 100. Component max scores are
      // retained for the breakdown, but must not turn 1/1 into 100% overall.
      const maxScore = 100;
      const percentage = assessments.length ? Math.min(100, score) : null;
      return {
        ...row,
        score,
        maxScore,
        percentage,
        grade:
          percentage === null
            ? null
            : (scale.find(([, minimum]) => percentage >= minimum)?.[0] ?? null),
      };
    });
    const classrooms = new Map<
      string,
      { classroom: Classroom; subjects: (typeof subjects)[number][] }
    >();
    for (const subject of subjects) {
      const key = subject.classroom.id;
      const current = classrooms.get(key) ?? {
        classroom: subject.classroom,
        subjects: [],
      };
      current.subjects.push(subject);
      classrooms.set(key, current);
    }
    return {
      gradeScale: Object.fromEntries(scale),
      classrooms: [...classrooms.values()].sort((a, b) =>
        a.classroom.name.localeCompare(b.classroom.name),
      ),
    };
  }

  async summary(user: AuthUser, classroomId?: string, subjectId?: string) {
    const [classrooms, gradeRows] = await Promise.all([
      this.prisma.classroom.findMany({
        where: {
          organizationId: user.organizationId,
          isActive: true,
          ...(classroomId ? { id: classroomId } : {}),
          ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
        },
        select: {
          id: true,
          name: true,
          gradeLevel: true,
          academicYear: true,
          enrollments: {
            select: {
              student: {
                select: {
                  id: true,
                  studentCode: true,
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          exams: {
            where: subjectId ? { subjectId } : undefined,
            select: {
              id: true,
              title: true,
              subject: { select: { id: true, code: true, name: true } },
              attempts: {
                where: { status: AttemptStatus.GRADED },
                select: {
                  examId: true,
                  studentId: true,
                  score: true,
                  maxScore: true,
                  percentage: true,
                },
              },
            },
          },
          assignments: {
            where: subjectId ? { subjectId } : undefined,
            select: {
              id: true,
              title: true,
              maxScore: true,
              subject: { select: { id: true, code: true, name: true } },
              submissions: {
                where: { status: SubmissionStatus.GRADED },
                select: {
                  studentId: true,
                  score: true,
                  members: { select: { studentId: true, score: true } },
                },
              },
            },
          },
          codingTests: {
            where: subjectId ? { subjectId } : undefined,
            select: {
              id: true,
              title: true,
              subject: { select: { id: true, code: true, name: true } },
              attempts: {
                where: { status: AttemptStatus.GRADED },
                select: {
                  studentId: true,
                  score: true,
                  maxScore: true,
                  percentage: true,
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.gradeScale.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { minPercentage: 'desc' },
      }),
    ]);
    const scale = gradeRows.length
      ? gradeRows.map((row) => [row.grade, Number(row.minPercentage)] as const)
      : Object.entries(DEFAULT_GRADES);
    return {
      gradeScale: Object.fromEntries(scale),
      classrooms: classrooms.map((classroom) => {
        const subjectMap = new Map<string, Subject>();
        classroom.exams.forEach((exam) =>
          subjectMap.set(exam.subject.id, exam.subject),
        );
        classroom.assignments.forEach((assignment) =>
          subjectMap.set(assignment.subject.id, assignment.subject),
        );
        classroom.codingTests.forEach((test) =>
          subjectMap.set(test.subject.id, test.subject),
        );
        return {
          classroom: {
            id: classroom.id,
            name: classroom.name,
            gradeLevel: classroom.gradeLevel,
            academicYear: classroom.academicYear,
          },
          subjects: [...subjectMap.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((subject) => ({
              subject,
              students: classroom.enrollments
                .map(({ student }) => {
                  let examScore = 0;
                  let examMaxScore = 0;
                  let examCount = 0;
                  const examResults: DetailScore[] = [];
                  for (const exam of classroom.exams.filter(
                    (item) => item.subject.id === subject.id,
                  )) {
                    const attempts = exam.attempts.filter(
                      (item) => item.studentId === student.id,
                    );
                    const best = attempts.sort(
                      (a, b) =>
                        Number(b.percentage ?? 0) - Number(a.percentage ?? 0),
                    )[0];
                    if (best) {
                      examScore += Number(best.score ?? 0);
                      examMaxScore += Number(best.maxScore ?? 0);
                      examCount += 1;
                      examResults.push({
                        id: best.examId,
                        title: exam.title,
                        score: Number(best.score ?? 0),
                        maxScore: Number(best.maxScore ?? 0),
                      });
                    }
                  }
                  for (const test of classroom.codingTests.filter(
                    (item) => item.subject.id === subject.id,
                  )) {
                    const result = test.attempts.find(
                      (item) => item.studentId === student.id,
                    );
                    if (result) {
                      examScore += Number(result.score ?? 0);
                      examMaxScore += Number(result.maxScore ?? 0);
                      examCount += 1;
                      examResults.push({
                        id: test.id,
                        title: `${test.title} · Coding Test`,
                        score: Number(result.score ?? 0),
                        maxScore: Number(result.maxScore ?? 0),
                      });
                    }
                  }
                  let assignmentScore = 0;
                  let assignmentMaxScore = 0;
                  let assignmentCount = 0;
                  const assignmentResults: DetailScore[] = [];
                  for (const assignment of classroom.assignments.filter(
                    (item) => item.subject.id === subject.id,
                  )) {
                    const submission = assignment.submissions.find(
                      (item) =>
                        item.studentId === student.id ||
                        item.members.some(
                          (member) => member.studentId === student.id,
                        ),
                    );
                    if (submission) {
                      const memberScore = submission.members.find(
                        (member) => member.studentId === student.id,
                      )?.score;
                      const score = Number(
                        memberScore ?? submission.score ?? 0,
                      );
                      assignmentScore += score;
                      assignmentMaxScore += Number(assignment.maxScore);
                      assignmentCount += 1;
                      assignmentResults.push({
                        id: assignment.id,
                        title: assignment.title,
                        score,
                        maxScore: Number(assignment.maxScore),
                      });
                    }
                  }
                  const score = examScore + assignmentScore;
                  // Subject score is a raw score out of 100; exam/assignment
                  // max scores are shown only as component breakdowns.
                  const maxScore = 100;
                  const percentage =
                    examCount + assignmentCount ? Math.min(100, score) : null;
                  return {
                    id: student.id,
                    studentCode: student.studentCode,
                    name: `${student.user.firstName} ${student.user.lastName}`,
                    examScore,
                    examMaxScore,
                    examCount,
                    assignmentScore,
                    assignmentMaxScore,
                    assignmentCount,
                    examResults,
                    assignmentResults,
                    score,
                    maxScore,
                    percentage,
                    grade:
                      percentage === null
                        ? null
                        : (scale.find(
                            ([, minimum]) => percentage >= minimum,
                          )?.[0] ?? null),
                  };
                })
                .sort((a, b) => a.studentCode.localeCompare(b.studentCode)),
            })),
        };
      }),
    };
  }
}

type Classroom = {
  id: string;
  name: string;
  gradeLevel: string | null;
  academicYear: string;
};
type Subject = { id: string; code: string; name: string };
type Assessment = {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  gradedAt: Date | null;
};
type DetailScore = {
  id: string;
  title: string;
  score: number;
  maxScore: number;
};
type RecordRow = {
  classroom: Classroom;
  subject: Subject;
  exams: Assessment[];
  assignments: Assessment[];
};
