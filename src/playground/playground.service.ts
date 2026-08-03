import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CodeLanguage, UserRole } from '@prisma/client';
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

  async listProblems(user: AuthUser) {
    if (user.role === UserRole.STUDENT)
      await this.assertEnabled(user.organizationId);
    const rows = await this.prisma.playgroundProblem.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.STUDENT ? { isActive: true } : {}),
      },
      orderBy: [
        { difficulty: 'asc' },
        { position: 'asc' },
        { createdAt: 'desc' },
      ],
    });
    return rows.map((row) => ({
      ...row,
      previewUrl: this.googleDrivePreviewUrl(row.driveUrl),
    }));
  }

  async createProblem(
    organizationId: string,
    input: {
      title: string;
      description?: string;
      difficulty: 'EASY' | 'MEDIUM' | 'HARD';
      driveUrl: string;
      isActive?: boolean;
      position?: number;
    },
  ) {
    this.googleDrivePreviewUrl(input.driveUrl);
    return this.withPreview(
      await this.prisma.playgroundProblem.create({
        data: {
          organizationId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          difficulty: input.difficulty,
          driveUrl: input.driveUrl.trim(),
          isActive: input.isActive ?? true,
          position: input.position ?? 0,
        },
      }),
    );
  }

  async updateProblem(
    organizationId: string,
    id: string,
    input: {
      title: string;
      description?: string;
      difficulty: 'EASY' | 'MEDIUM' | 'HARD';
      driveUrl: string;
      isActive?: boolean;
      position?: number;
    },
  ) {
    await this.assertProblemOwner(organizationId, id);
    this.googleDrivePreviewUrl(input.driveUrl);
    return this.withPreview(
      await this.prisma.playgroundProblem.update({
        where: { id },
        data: {
          title: input.title.trim(),
          description: input.description?.trim() || null,
          difficulty: input.difficulty,
          driveUrl: input.driveUrl.trim(),
          isActive: input.isActive ?? true,
          position: input.position ?? 0,
        },
      }),
    );
  }

  async deleteProblem(organizationId: string, id: string) {
    await this.assertProblemOwner(organizationId, id);
    await this.prisma.playgroundProblem.delete({ where: { id } });
    return { deleted: true };
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

  private async assertProblemOwner(organizationId: string, id: string) {
    const problem = await this.prisma.playgroundProblem.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!problem) throw new NotFoundException('ไม่พบโจทย์ Playground');
  }

  private withPreview<T extends { driveUrl: string }>(row: T) {
    return { ...row, previewUrl: this.googleDrivePreviewUrl(row.driveUrl) };
  }

  private googleDrivePreviewUrl(rawUrl: string) {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('ลิงก์ Google Drive ไม่ถูกต้อง');
    }
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname))
      throw new BadRequestException('กรุณาใช้ลิงก์จาก Google Drive เท่านั้น');

    const pathMatch = url.pathname.match(
      /\/(?:file|document|spreadsheets|presentation)\/d\/([^/]+)/,
    );
    const fileId = pathMatch?.[1] ?? url.searchParams.get('id');
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId))
      throw new BadRequestException('ไม่พบรหัสไฟล์ในลิงก์ Google Drive');

    if (url.pathname.includes('/document/d/'))
      return `https://docs.google.com/document/d/${fileId}/preview`;
    if (url.pathname.includes('/spreadsheets/d/'))
      return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
    if (url.pathname.includes('/presentation/d/'))
      return `https://docs.google.com/presentation/d/${fileId}/embed`;
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }
}
