import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CodeLanguage } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { AiService } from '../ai/ai.service';
import { CodeRunnerService } from '../assignments/code-runner.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlaygroundService {
  private readonly activeStudentRuns = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly codeRunner: CodeRunnerService,
    private readonly ai: AiService,
  ) {}

  async status(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { playgroundEnabled: true },
    });
  }

  async setEnabled(organizationId: string, enabled: boolean) {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { playgroundEnabled: enabled },
      select: { playgroundEnabled: true },
    });
  }

  async run(
    user: AuthUser,
    input: { language: CodeLanguage; sourceCode: string; stdin?: string },
  ) {
    await this.assertEnabled(user.organizationId);
    if (!input.sourceCode.trim())
      throw new BadRequestException('กรุณาเขียนโค้ดก่อนทดลองรัน');
    if (this.activeStudentRuns.has(user.sub))
      throw new ConflictException('มีโค้ดของคุณกำลังรอหรือทำงานอยู่');

    this.activeStudentRuns.add(user.sub);
    try {
      return await this.codeRunner.run(
        input.language,
        input.sourceCode,
        input.stdin,
      );
    } finally {
      this.activeStudentRuns.delete(user.sub);
    }
  }

  async advice(
    user: AuthUser,
    input: { language: CodeLanguage; sourceCode: string },
  ) {
    await this.assertEnabled(user.organizationId);
    if (!input.sourceCode.trim())
      throw new BadRequestException('กรุณาเขียนโค้ดก่อนขอคำแนะนำ');
    return this.ai.advisePlaygroundCode(
      { organizationId: user.organizationId, requestedById: user.sub },
      input,
    );
  }

  private async assertEnabled(organizationId: string) {
    const { playgroundEnabled } = await this.status(organizationId);
    if (!playgroundEnabled)
      throw new ForbiddenException('ผู้ดูแลระบบปิดใช้งาน Playground');
  }
}
