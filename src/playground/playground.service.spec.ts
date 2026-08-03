import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CodeLanguage, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PlaygroundService } from './playground.service';

const student: AuthUser = {
  sub: 'student-1',
  organizationId: 'org-1',
  role: UserRole.STUDENT,
  email: 'student@example.com',
};

describe('PlaygroundService', () => {
  it('runs student code through the sandbox when Playground is enabled', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          playgroundEnabled: true,
        }),
      },
    };
    const codeRunner = {
      run: jest.fn().mockResolvedValue({ statusId: 3, stdout: 'Hello\n' }),
    };
    const service = new PlaygroundService(
      prisma as never,
      codeRunner as never,
      {} as never,
    );

    await expect(
      service.run(student, {
        language: CodeLanguage.PYTHON,
        sourceCode: 'print("Hello")',
      }),
    ).resolves.toMatchObject({ statusId: 3, stdout: 'Hello\n' });
    expect(codeRunner.run).toHaveBeenCalledWith(
      CodeLanguage.PYTHON,
      'print("Hello")',
      undefined,
    );
  });

  it('blocks new runs when the administrator disables Playground', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          playgroundEnabled: false,
        }),
      },
    };
    const codeRunner = { run: jest.fn() };
    const service = new PlaygroundService(
      prisma as never,
      codeRunner as never,
      {} as never,
    );

    await expect(
      service.run(student, {
        language: CodeLanguage.CPP,
        sourceCode: 'int main() {}',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(codeRunner.run).not.toHaveBeenCalled();
  });

  it('creates a problem and converts a Drive share link to an embeddable preview', async () => {
    const playgroundProblem = {
      create: jest.fn().mockResolvedValue({
        id: 'problem-1',
        organizationId: 'org-1',
        title: 'Hello World',
        description: null,
        difficulty: 'EASY',
        driveUrl: 'https://drive.google.com/file/d/file_123/view?usp=sharing',
        isActive: true,
        position: 0,
      }),
    };
    const service = new PlaygroundService(
      { playgroundProblem } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createProblem('org-1', {
        title: '  Hello World  ',
        difficulty: 'EASY',
        driveUrl: 'https://drive.google.com/file/d/file_123/view?usp=sharing',
      }),
    ).resolves.toMatchObject({
      title: 'Hello World',
      previewUrl: 'https://drive.google.com/file/d/file_123/preview',
      isActive: true,
    });
  });

  it('rejects a problem link that is not from Google Drive', async () => {
    const service = new PlaygroundService(
      { playgroundProblem: { create: jest.fn() } } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createProblem('org-1', {
        title: 'Unsafe link',
        difficulty: 'HARD',
        driveUrl: 'https://example.com/problem.pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
