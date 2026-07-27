import { ForbiddenException } from '@nestjs/common';
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
});
