import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  AssignmentType,
  GroupGradingMode,
  SubmissionStatus,
  UserRole,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAssignmentDto,
  ClassroomGradeDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  RunCodeDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';
import { CodeRunnerService } from './code-runner.service';

const DEFAULT_GRADES = { A: 80, B: 70, C: 60, D: 50, F: 0 };

@Injectable()
export class AssignmentsService {
  private readonly activeStudentRuns = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly codeRunner: CodeRunnerService,
  ) {}

  async list(user: AuthUser) {
    const scale = await this.gradeScale(user);
    if (user.role === UserRole.STUDENT) {
      const student = await this.student(user);
      const rows = await this.prisma.assignment.findMany({
        where: {
          organizationId: user.organizationId,
          status: { in: [AssignmentStatus.PUBLISHED, AssignmentStatus.CLOSED] },
          classroom: { enrollments: { some: { studentId: student.id } } },
        },
        include: {
          classroom: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
          submissions: {
            where: {
              OR: [
                { studentId: student.id },
                { members: { some: { studentId: student.id } } },
              ],
            },
            include: {
              members: {
                include: {
                  student: {
                    select: {
                      id: true,
                      studentCode: true,
                      user: { select: { firstName: true, lastName: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { dueAt: 'asc' },
      });
      const classmates = await this.prisma.enrollment.findMany({
        where: {
          classroomId: {
            in: rows
              .filter((row) => row.isGroupWork)
              .map((row) => row.classroomId),
          },
          studentId: { not: student.id },
          student: { user: { isActive: true } },
        },
        select: {
          classroomId: true,
          student: {
            select: {
              id: true,
              studentCode: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
      return rows.map((row) => ({
        ...row,
        eligibleMembers: row.isGroupWork
          ? classmates
              .filter((item) => item.classroomId === row.classroomId)
              .map((item) => item.student)
          : [],
        submissions: row.submissions.map((item) => {
          const membership = item.members.find(
            (member) => member.studentId === student.id,
          );
          const score = membership?.score ?? item.score;
          const feedback = membership?.feedback ?? item.feedback;
          return {
            ...item,
            canEdit: item.studentId === student.id,
            score,
            feedback: feedback?.replace(/\bAI\b/gi, 'ระบบ') ?? null,
            grade: this.letterGrade(score, row.maxScore, scale),
            assessment: this.assignmentAssessment(score, row.maxScore),
          };
        }),
      }));
    }
    const rows = await this.prisma.assignment.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
      include: {
        classroom: {
          select: {
            id: true,
            name: true,
            enrollments: {
              where: { student: { user: { isActive: true } } },
              select: {
                student: {
                  select: {
                    id: true,
                    studentCode: true,
                    user: { select: { firstName: true, lastName: true } },
                  },
                },
              },
              orderBy: { student: { studentCode: 'asc' } },
            },
          },
        },
        subject: { select: { id: true, name: true } },
        submissions: {
          include: {
            student: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
            members: {
              include: {
                student: {
                  select: {
                    id: true,
                    studentCode: true,
                    user: { select: { firstName: true, lastName: true } },
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { submittedAt: 'desc' },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { dueAt: 'desc' },
    });
    return rows.map((row) => ({
      ...row,
      students: row.classroom.enrollments.map(
        (enrollment) => enrollment.student,
      ),
      classroom: { id: row.classroom.id, name: row.classroom.name },
      submissions: row.submissions.map((item) => ({
        ...item,
        feedback: item.feedback?.replace(/\bAI\b/gi, 'ระบบ') ?? null,
        grade: this.letterGrade(item.score, row.maxScore, scale),
        assessment: this.assignmentAssessment(item.score, row.maxScore),
      })),
    }));
  }

  async create(user: AuthUser, dto: CreateAssignmentDto) {
    await this.validateRelations(user, dto.classroomId, dto.subjectId);
    this.validateCodeSettings(dto);
    const type = dto.type ?? AssignmentType.GENERAL;
    this.validateGroupSettings(dto);
    return this.prisma.assignment.create({
      data: {
        ...dto,
        type,
        codeLanguage: type === AssignmentType.CODE ? dto.codeLanguage : null,
        problemPdfUrl:
          type === AssignmentType.CODE
            ? dto.problemPdfUrl?.trim() || null
            : null,
        aiGradingEnabled:
          type === AssignmentType.CODE
            ? (dto.aiGradingEnabled ?? false)
            : false,
        aiGradingModel:
          type === AssignmentType.CODE && dto.aiGradingEnabled
            ? dto.aiGradingModel
            : null,
        dueAt: new Date(dto.dueAt),
        organizationId: user.organizationId,
        createdById: user.sub,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateAssignmentDto) {
    const assignment = await this.managed(user, id);
    if (
      dto.isGroupWork !== undefined &&
      dto.isGroupWork !== assignment.isGroupWork &&
      (await this.prisma.assignmentSubmission.count({
        where: { assignmentId: id },
      })) > 0
    )
      throw new BadRequestException(
        'ไม่สามารถเปลี่ยนระหว่างงานเดี่ยวกับงานกลุ่มหลังมีผู้ส่งงานแล้ว',
      );
    const type = dto.type ?? assignment.type;
    if (dto.classroomId || dto.subjectId)
      await this.validateRelations(
        user,
        dto.classroomId ?? assignment.classroomId,
        dto.subjectId ?? assignment.subjectId,
      );
    this.validateCodeSettings({
      type,
      codeLanguage: dto.codeLanguage ?? assignment.codeLanguage ?? undefined,
      aiGradingEnabled: dto.aiGradingEnabled ?? assignment.aiGradingEnabled,
      aiGradingModel:
        dto.aiGradingModel ?? assignment.aiGradingModel ?? undefined,
    });
    this.validateGroupSettings({
      isGroupWork: dto.isGroupWork ?? assignment.isGroupWork,
      minGroupSize: dto.minGroupSize ?? assignment.minGroupSize,
      maxGroupSize: dto.maxGroupSize ?? assignment.maxGroupSize,
    });
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...dto,
        type,
        codeLanguage:
          type === AssignmentType.CODE
            ? (dto.codeLanguage ?? assignment.codeLanguage)
            : null,
        problemPdfUrl:
          type === AssignmentType.CODE
            ? dto.problemPdfUrl === undefined
              ? assignment.problemPdfUrl
              : dto.problemPdfUrl.trim() || null
            : null,
        aiGradingEnabled:
          type === AssignmentType.CODE
            ? (dto.aiGradingEnabled ?? assignment.aiGradingEnabled)
            : false,
        aiGradingModel:
          type === AssignmentType.CODE &&
          (dto.aiGradingEnabled ?? assignment.aiGradingEnabled)
            ? (dto.aiGradingModel ?? assignment.aiGradingModel)
            : null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const assignment = await this.managed(user, id);
    const count = await this.prisma.assignmentSubmission.count({
      where: { assignmentId: id },
    });
    if (count)
      throw new BadRequestException('ไม่สามารถลบงานที่มีนักเรียนส่งแล้วได้');
    await this.prisma.assignment.delete({ where: { id: assignment.id } });
    return { deleted: true, id };
  }

  async submit(user: AuthUser, id: string, dto: SubmitAssignmentDto) {
    const attachmentUrls = [
      ...(dto.attachmentUrls ?? []),
      ...(dto.attachmentUrl ? [dto.attachmentUrl] : []),
    ]
      .map((url) => url.trim())
      .filter((url, index, rows) => url && rows.indexOf(url) === index);
    if (attachmentUrls.length > 20)
      throw new BadRequestException('เพิ่มลิงก์งานได้ไม่เกิน 20 ลิงก์');
    if (!dto.content?.trim() && !attachmentUrls.length)
      throw new BadRequestException('กรุณากรอกรายละเอียดหรือแนบลิงก์งาน');
    const student = await this.student(user);
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        classroom: { enrollments: { some: { studentId: student.id } } },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.type === AssignmentType.CODE && !dto.content?.trim())
      throw new BadRequestException('กรุณาวาง source code ที่ต้องการส่ง');
    const previous = await this.prisma.assignmentSubmission.findFirst({
      where: {
        assignmentId: id,
        OR: [
          { studentId: student.id },
          { members: { some: { studentId: student.id } } },
        ],
      },
      include: { members: true },
    });
    if (assignment.status !== AssignmentStatus.PUBLISHED && !previous)
      throw new BadRequestException('งานนี้ปิดรับแล้ว');
    if (previous?.status === SubmissionStatus.GRADED)
      throw new BadRequestException('งานนี้ตรวจคะแนนแล้ว ไม่สามารถส่งใหม่ได้');
    if (previous && previous.studentId !== student.id)
      throw new BadRequestException(
        'งานกลุ่มนี้ส่งโดยเพื่อนในกลุ่มแล้ว มีเพียงผู้ส่งเดิมที่แก้ไขได้',
      );
    let groupMembers: Array<{ studentId: string; role: string }> = [];
    if (assignment.isGroupWork) {
      if (!dto.groupName?.trim() || !dto.submitterRole?.trim() || !dto.members)
        throw new BadRequestException(
          'กรุณาตั้งชื่อกลุ่ม เลือกสมาชิก และระบุหน้าที่ของทุกคน',
        );
      const memberIds = dto.members.map((member) => member.studentId);
      if (new Set(memberIds).size !== memberIds.length)
        throw new BadRequestException('มีสมาชิกซ้ำกันในกลุ่ม');
      if (memberIds.includes(student.id))
        throw new BadRequestException(
          'ไม่ต้องเพิ่มชื่อตนเองซ้ำในรายชื่อเพื่อน',
        );
      const total = memberIds.length + 1;
      if (total < assignment.minGroupSize || total > assignment.maxGroupSize)
        throw new BadRequestException(
          `กลุ่มต้องมีสมาชิก ${assignment.minGroupSize}-${assignment.maxGroupSize} คน`,
        );
      const classmates = await this.prisma.enrollment.count({
        where: {
          classroomId: assignment.classroomId,
          studentId: { in: memberIds },
          student: {
            organizationId: user.organizationId,
            user: { isActive: true },
          },
        },
      });
      if (classmates !== memberIds.length)
        throw new BadRequestException(
          'สมาชิกทุกคนต้องเป็นนักเรียนที่อยู่ห้องเดียวกัน',
        );
      groupMembers = [
        { studentId: student.id, role: dto.submitterRole.trim() },
        ...dto.members.map((member) => ({
          studentId: member.studentId,
          role: member.role.trim(),
        })),
      ];
      if (groupMembers.some((member) => !member.role))
        throw new BadRequestException('กรุณาระบุหน้าที่ของสมาชิกทุกคน');
      const occupied = await this.prisma.assignmentSubmissionMember.count({
        where: {
          assignmentId: id,
          studentId: { in: groupMembers.map((member) => member.studentId) },
          ...(previous ? { submissionId: { not: previous.id } } : {}),
        },
      });
      if (occupied)
        throw new BadRequestException('มีสมาชิกบางคนส่งงานนี้กับกลุ่มอื่นแล้ว');
    } else if (dto.groupName || dto.members?.length) {
      throw new BadRequestException(
        'งานนี้เป็นงานเดี่ยว ไม่สามารถเพิ่มสมาชิกได้',
      );
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const saved = previous
        ? await tx.assignmentSubmission.update({
            where: { id: previous.id },
            data: {
              content: dto.content,
              attachmentUrl: dto.attachmentUrl,
              attachmentUrls,
              groupName: assignment.isGroupWork ? dto.groupName!.trim() : null,
              submittedAt: new Date(),
            },
          })
        : await tx.assignmentSubmission.create({
            data: {
              assignmentId: id,
              studentId: student.id,
              content: dto.content,
              attachmentUrl: dto.attachmentUrl,
              attachmentUrls,
              groupName: assignment.isGroupWork ? dto.groupName!.trim() : null,
            },
          });
      if (assignment.isGroupWork) {
        await tx.assignmentSubmissionMember.deleteMany({
          where: { submissionId: saved.id },
        });
        await tx.assignmentSubmissionMember.createMany({
          data: groupMembers.map((member) => ({
            ...member,
            assignmentId: id,
            submissionId: saved.id,
          })),
        });
      }
      return saved;
    });
    if (assignment.type !== AssignmentType.CODE || !assignment.aiGradingEnabled)
      return submission;
    try {
      const result = await this.ai.gradeCode(
        { organizationId: user.organizationId, requestedById: user.sub },
        {
          assignment: `${assignment.title}\n${assignment.description}`,
          language: assignment.codeLanguage ?? 'CODE',
          sourceCode: dto.content!.trim(),
          maxScore: Number(assignment.maxScore),
        },
        assignment.aiGradingModel,
      );
      const score = Math.max(
        0,
        Math.min(Number(assignment.maxScore), Number(result.score) || 0),
      );
      const graded = await this.prisma.assignmentSubmission.update({
        where: { id: submission.id },
        data: {
          status: SubmissionStatus.GRADED,
          score,
          feedback: result.feedback.replace(/\bAI\b/gi, 'ระบบ'),
          gradedAt: new Date(),
        },
      });
      if (assignment.isGroupWork)
        await this.prisma.assignmentSubmissionMember.updateMany({
          where: { submissionId: submission.id },
          data: { score },
        });
      return graded;
    } catch {
      return this.prisma.assignmentSubmission.update({
        where: { id: submission.id },
        data: {
          feedback:
            'ระบบตรวจอัตโนมัติยังไม่พร้อมในขณะนี้ งานถูกส่งแล้วและกำลังรอครูตรวจ',
        },
      });
    }
  }

  async runCode(user: AuthUser, id: string, dto: RunCodeDto) {
    if (!dto.sourceCode.trim())
      throw new BadRequestException('กรุณาเขียนโค้ดก่อนทดลองรัน');
    if (this.activeStudentRuns.has(user.sub))
      throw new ConflictException(
        'มีงานทดลองรันโค้ดของนักเรียนนี้กำลังรอหรือทำงานอยู่',
      );

    this.activeStudentRuns.add(user.sub);
    try {
      const student = await this.student(user);
      const assignment = await this.prisma.assignment.findFirst({
        where: {
          id,
          organizationId: user.organizationId,
          type: AssignmentType.CODE,
          classroom: { enrollments: { some: { studentId: student.id } } },
        },
        select: { codeLanguage: true },
      });
      if (!assignment?.codeLanguage)
        throw new NotFoundException('ไม่พบงานเขียนโค้ดนี้');
      return await this.codeRunner.run(
        assignment.codeLanguage,
        dto.sourceCode,
        dto.stdin,
      );
    } finally {
      this.activeStudentRuns.delete(user.sub);
    }
  }

  async runSubmissionCode(
    user: AuthUser,
    id: string,
    submissionId: string,
    dto: { stdin?: string },
  ) {
    const assignment = await this.managed(user, id);
    if (assignment.type !== AssignmentType.CODE || !assignment.codeLanguage)
      throw new BadRequestException('งานนี้ไม่ใช่งานเขียนโปรแกรม');
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id: submissionId, assignmentId: assignment.id },
      select: { content: true },
    });
    if (!submission?.content?.trim())
      throw new NotFoundException('ไม่พบ source code ที่นักเรียนส่ง');
    return this.codeRunner.run(
      assignment.codeLanguage,
      submission.content,
      dto.stdin,
    );
  }

  async grade(
    user: AuthUser,
    id: string,
    submissionId: string,
    dto: GradeSubmissionDto,
  ) {
    const assignment = await this.managed(user, id);
    if (dto.score > Number(assignment.maxScore))
      throw new BadRequestException('คะแนนเกินคะแนนเต็ม');
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id: submissionId, assignmentId: id },
      include: { members: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    const gradingMode = assignment.isGroupWork
      ? (dto.gradingMode ?? GroupGradingMode.SHARED)
      : null;
    if (
      gradingMode === GroupGradingMode.INDIVIDUAL &&
      (!dto.memberScores ||
        dto.memberScores.length !== submission.members.length)
    )
      throw new BadRequestException('กรุณาให้คะแนนสมาชิกทุกคนในกลุ่ม');
    if (
      dto.memberScores?.some(
        (member) => member.score > Number(assignment.maxScore),
      )
    )
      throw new BadRequestException('คะแนนรายบุคคลเกินคะแนนเต็ม');
    if (gradingMode === GroupGradingMode.INDIVIDUAL) {
      const expected = new Set(
        submission.members.map((member) => member.studentId),
      );
      if (
        new Set(dto.memberScores!.map((member) => member.studentId)).size !==
          expected.size ||
        dto.memberScores!.some((member) => !expected.has(member.studentId))
      )
        throw new BadRequestException('รายชื่อผู้รับคะแนนไม่ตรงกับสมาชิกกลุ่ม');
    }
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.assignmentSubmission.update({
        where: { id: submission.id },
        data: {
          score: gradingMode === GroupGradingMode.INDIVIDUAL ? null : dto.score,
          feedback: dto.feedback,
          gradingMode,
          status: SubmissionStatus.GRADED,
          gradedAt: new Date(),
          gradedById: user.sub,
        },
      });
      if (assignment.isGroupWork) {
        if (gradingMode === GroupGradingMode.SHARED) {
          await tx.assignmentSubmissionMember.updateMany({
            where: { submissionId: submission.id },
            data: { score: dto.score, feedback: dto.feedback },
          });
        } else {
          await Promise.all(
            dto.memberScores!.map((member) =>
              tx.assignmentSubmissionMember.update({
                where: {
                  assignmentId_studentId: {
                    assignmentId: assignment.id,
                    studentId: member.studentId,
                  },
                },
                data: { score: member.score, feedback: member.feedback },
              }),
            ),
          );
        }
      }
      return saved;
    });
  }

  async gradeClassroom(
    user: AuthUser,
    id: string,
    grades: ClassroomGradeDto[],
  ) {
    const assignment = await this.managed(user, id);
    if (assignment.isGroupWork)
      throw new BadRequestException(
        'งานกลุ่มต้องให้คะแนนจากรายการส่งงานของแต่ละกลุ่ม',
      );
    if (!grades.length)
      throw new BadRequestException('กรุณากรอกคะแนนอย่างน้อย 1 คน');
    const studentIds = grades.map((grade) => grade.studentId);
    if (new Set(studentIds).size !== studentIds.length)
      throw new BadRequestException('มีรายชื่อนักเรียนซ้ำกัน');
    if (
      grades.some(
        (grade) =>
          !Number.isFinite(grade.score) ||
          grade.score < 0 ||
          grade.score > Number(assignment.maxScore),
      )
    )
      throw new BadRequestException('คะแนนไม่ถูกต้องหรือเกินคะแนนเต็ม');
    const enrolledCount = await this.prisma.enrollment.count({
      where: {
        classroomId: assignment.classroomId,
        studentId: { in: studentIds },
        student: {
          organizationId: user.organizationId,
          user: { isActive: true },
        },
      },
    });
    if (enrolledCount !== studentIds.length)
      throw new BadRequestException('ให้คะแนนได้เฉพาะนักเรียนที่อยู่ในห้องนี้');

    const gradedAt = new Date();
    await this.prisma.$transaction(
      grades.map((grade) =>
        this.prisma.assignmentSubmission.upsert({
          where: {
            assignmentId_studentId: {
              assignmentId: assignment.id,
              studentId: grade.studentId,
            },
          },
          create: {
            assignmentId: assignment.id,
            studentId: grade.studentId,
            score: grade.score,
            feedback: grade.feedback,
            status: SubmissionStatus.GRADED,
            gradedAt,
            gradedById: user.sub,
          },
          update: {
            score: grade.score,
            feedback: grade.feedback,
            status: SubmissionStatus.GRADED,
            gradedAt,
            gradedById: user.sub,
          },
        }),
      ),
    );
    return { graded: grades.length };
  }

  async gradeScale(user: AuthUser) {
    const rows = await this.prisma.gradeScale.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { minPercentage: 'desc' },
    });
    return rows.length
      ? Object.fromEntries(
          rows.map((row) => [row.grade, Number(row.minPercentage)]),
        )
      : DEFAULT_GRADES;
  }

  async updateGradeScale(user: AuthUser, grades: Record<string, number>) {
    const rows = Object.entries(grades).map(([grade, value]) => ({
      grade: grade.trim().toUpperCase(),
      minPercentage: Number(value),
    }));
    if (
      !rows.length ||
      rows.some(
        (row) =>
          !row.grade ||
          !Number.isFinite(row.minPercentage) ||
          row.minPercentage < 0 ||
          row.minPercentage > 100,
      )
    )
      throw new BadRequestException('เกณฑ์เกรดไม่ถูกต้อง');
    if (new Set(rows.map((row) => row.grade)).size !== rows.length)
      throw new BadRequestException('ชื่อเกรดซ้ำกัน');
    await this.prisma.$transaction(async (tx) => {
      await tx.gradeScale.deleteMany({
        where: { organizationId: user.organizationId },
      });
      await tx.gradeScale.createMany({
        data: rows.map((row) => ({
          ...row,
          organizationId: user.organizationId,
        })),
      });
    });
    return this.gradeScale(user);
  }

  private async managed(user: AuthUser, id: string) {
    const row = await this.prisma.assignment.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        ...(user.role === UserRole.TEACHER ? { createdById: user.sub } : {}),
      },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    return row;
  }

  private async validateRelations(
    user: AuthUser,
    classroomId: string,
    subjectId: string,
  ) {
    const [room, subject] = await Promise.all([
      this.prisma.classroom.findFirst({
        where: {
          id: classroomId,
          organizationId: user.organizationId,
          isActive: true,
          ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
        },
      }),
      this.prisma.subject.findFirst({
        where: { id: subjectId, organizationId: user.organizationId },
      }),
    ]);
    if (!room)
      throw new ForbiddenException('Classroom not found or not managed by you');
    if (!subject) throw new NotFoundException('Subject not found');
  }

  private async student(user: AuthUser) {
    const row = await this.prisma.studentProfile.findFirst({
      where: { userId: user.sub, organizationId: user.organizationId },
    });
    if (!row) throw new ForbiddenException('Student profile not found');
    return row;
  }

  private validateCodeSettings(dto: {
    type?: AssignmentType;
    codeLanguage?: unknown;
    aiGradingEnabled?: boolean;
    aiGradingModel?: string;
  }) {
    const type = dto.type ?? AssignmentType.GENERAL;
    if (type === AssignmentType.CODE && !dto.codeLanguage)
      throw new BadRequestException('กรุณาเลือกภาษาสำหรับงานเขียนโปรแกรม');
    if (type !== AssignmentType.CODE && dto.aiGradingEnabled)
      throw new BadRequestException('เปิดตรวจอัตโนมัติได้เฉพาะงานชนิด Code');
    if (dto.aiGradingEnabled && !dto.aiGradingModel?.trim())
      throw new BadRequestException('กรุณาเลือกโมเดลสำหรับตรวจ Code');
    if (
      dto.aiGradingEnabled &&
      !/^(?:gemini|gpt)(?:[.-]|$)/i.test(dto.aiGradingModel?.trim() ?? '')
    )
      throw new BadRequestException('โมเดลตรวจ Code ต้องเป็น Gemini หรือ GPT');
  }

  private validateGroupSettings(dto: {
    isGroupWork?: boolean;
    minGroupSize?: number;
    maxGroupSize?: number;
  }) {
    if (!dto.isGroupWork) return;
    const min = dto.minGroupSize ?? 1;
    const max = dto.maxGroupSize ?? 5;
    if (min > max)
      throw new BadRequestException(
        'จำนวนสมาชิกขั้นต่ำต้องไม่มากกว่าจำนวนสูงสุด',
      );
  }

  private letterGrade(
    score: unknown,
    maxScore: unknown,
    scale: Record<string, number>,
  ) {
    if (score === null || score === undefined) return null;
    const percentage = Number(maxScore)
      ? (Number(score) / Number(maxScore)) * 100
      : 0;
    return (
      Object.entries(scale)
        .sort((a, b) => b[1] - a[1])
        .find(([, min]) => percentage >= min)?.[0] ?? null
    );
  }

  private assignmentAssessment(score: unknown, maxScore: unknown) {
    if (score === null || score === undefined) return null;
    const percentage = Number(maxScore)
      ? (Number(score) / Number(maxScore)) * 100
      : 0;
    if (percentage >= 80) return 'ดีเยี่ยม';
    if (percentage >= 70) return 'ดี';
    if (percentage >= 60) return 'พอใช้';
    return 'ปรับปรุง';
  }
}
