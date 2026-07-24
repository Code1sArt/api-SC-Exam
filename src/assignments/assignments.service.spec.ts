import { BadRequestException } from '@nestjs/common';
import { AssignmentType, SubmissionStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentsService } from './assignments.service';
import { AiService } from '../ai/ai.service';
import { CodeRunnerService } from './code-runner.service';

describe('AssignmentsService classroom grading', () => {
  const user: AuthUser = {
    sub: 'teacher-1',
    organizationId: 'org-1',
    role: UserRole.TEACHER,
    email: 'teacher@example.com',
  };

  const createService = (isGroupWork = false) => {
    const upsertInputs: unknown[] = [];
    const upsert = jest.fn().mockImplementation((input: unknown) => {
      upsertInputs.push(input);
      return Promise.resolve({});
    });
    const prisma = {
      assignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          organizationId: 'org-1',
          classroomId: 'classroom-1',
          createdById: 'teacher-1',
          maxScore: 20,
          isGroupWork,
          type: AssignmentType.GENERAL,
        }),
      },
      enrollment: { count: jest.fn().mockResolvedValue(2) },
      assignmentSubmission: { upsert },
      $transaction: jest
        .fn()
        .mockImplementation((operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
        ),
    } as unknown as PrismaService;

    return {
      service: new AssignmentsService(
        prisma,
        {} as AiService,
        {} as CodeRunnerService,
      ),
      upsert,
      upsertInputs,
    };
  };

  it('creates graded submissions for students who have not submitted online', async () => {
    const { service, upsert, upsertInputs } = createService();

    await expect(
      service.gradeClassroom(user, 'assignment-1', [
        { studentId: 'student-1', score: 18, feedback: 'ดีมาก' },
        { studentId: 'student-2', score: 0 },
      ]),
    ).resolves.toEqual({ graded: 2 });

    expect(upsert).toHaveBeenCalledTimes(2);
    const firstUpsert = upsertInputs[0] as {
      where: {
        assignmentId_studentId: {
          assignmentId: string;
          studentId: string;
        };
      };
      create: {
        score: number;
        status: SubmissionStatus;
        gradedById: string;
      };
    };
    expect(firstUpsert.where.assignmentId_studentId).toEqual({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
    });
    expect(firstUpsert.create).toMatchObject({
      score: 18,
      status: SubmissionStatus.GRADED,
      gradedById: 'teacher-1',
    });
  });

  it('keeps group assignments on the existing group grading flow', async () => {
    const { service, upsert } = createService(true);

    await expect(
      service.gradeClassroom(user, 'assignment-1', [
        { studentId: 'student-1', score: 18 },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
