import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isEmail } from 'class-validator';
import { randomBytes } from 'crypto';
import { readSheet } from 'read-excel-file/node';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateClassroomDto,
  CreateIndicatorDto,
  CreatePersonDto,
  CreateStudentDto,
  CreateSubjectDto,
  UpdateClassroomDto,
  UpdateIndicatorDto,
  UpdateStudentDto,
  UpdateSubjectDto,
} from './dto/academic.dto';

interface StudentSheetRow {
  student_code?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  password?: unknown;
  grade_level?: unknown;
}

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  subjects(user: AuthUser) {
    return this.prisma.subject.findMany({
      where: { organizationId: user.organizationId },
      include: {
        _count: {
          select: {
            indicators: true,
            questions: { where: { isActive: true } },
            exams: true,
            assignments: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  createSubject(user: AuthUser, dto: CreateSubjectDto) {
    return this.prisma.subject.create({
      data: {
        organizationId: user.organizationId,
        code: dto.code.toUpperCase(),
        name: dto.name,
      },
    });
  }

  async updateSubject(user: AuthUser, id: string, dto: UpdateSubjectDto) {
    const subject = await this.requireSubject(user.organizationId, id);
    try {
      return await this.prisma.subject.update({
        where: { id: subject.id },
        data: { code: dto.code?.toUpperCase(), name: dto.name },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Subject code already exists');
      throw error;
    }
  }

  async removeSubject(user: AuthUser, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        _count: {
          select: {
            questions: true,
            exams: true,
            indicators: true,
            assignments: true,
          },
        },
      },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    if (
      subject._count.questions ||
      subject._count.exams ||
      subject._count.assignments
    ) {
      throw new BadRequestException(
        'ไม่สามารถลบวิชาที่มีข้อสอบ ชุดข้อสอบ หรืองานใช้งานอยู่ได้',
      );
    }
    await this.prisma.subject.delete({ where: { id: subject.id } });
    return { deleted: true, id: subject.id };
  }

  async createIndicator(user: AuthUser, dto: CreateIndicatorDto) {
    await this.requireSubject(user.organizationId, dto.subjectId);
    return this.prisma.indicator.create({
      data: { ...dto, organizationId: user.organizationId },
    });
  }

  async updateIndicator(user: AuthUser, id: string, dto: UpdateIndicatorDto) {
    const indicator = await this.requireIndicator(user.organizationId, id);
    if (dto.subjectId)
      await this.requireSubject(user.organizationId, dto.subjectId);
    try {
      return await this.prisma.indicator.update({
        where: { id: indicator.id },
        data: {
          subjectId: dto.subjectId,
          code: dto.code,
          description: dto.description,
          gradeLevel: dto.gradeLevel,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Indicator code already exists');
      throw error;
    }
  }

  async removeIndicator(user: AuthUser, id: string) {
    const indicator = await this.requireIndicator(user.organizationId, id);
    const linkedQuestions = await this.prisma.question.count({
      where: { indicatorId: indicator.id },
    });
    await this.prisma.indicator.delete({ where: { id: indicator.id } });
    return {
      deleted: true,
      id: indicator.id,
      unlinkedQuestions: linkedQuestions,
    };
  }

  indicators(user: AuthUser, subjectId?: string) {
    return this.prisma.indicator.findMany({
      where: { organizationId: user.organizationId, subjectId },
      include: {
        subject: { select: { id: true, code: true, name: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async createClassroom(user: AuthUser, dto: CreateClassroomDto) {
    await this.ensureClassroomNameAvailable(
      user.organizationId,
      dto.name,
      dto.academicYear,
    );
    const teacherId =
      user.role === UserRole.TEACHER ? user.sub : (dto.teacherId ?? user.sub);
    const teacher = await this.prisma.user.findFirst({
      where: {
        id: teacherId,
        organizationId: user.organizationId,
        role: { in: [UserRole.TEACHER, UserRole.ADMIN] },
      },
    });
    if (!teacher) throw new BadRequestException('Teacher not found');
    return this.prisma.classroom.create({
      data: {
        organizationId: user.organizationId,
        teacherId,
        name: dto.name,
        academicYear: dto.academicYear,
        gradeLevel: dto.gradeLevel,
      },
    });
  }

  classrooms(user: AuthUser) {
    return this.prisma.classroom.findMany({
      where: {
        organizationId: user.organizationId,
        isActive: true,
        ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
      },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { enrollments: true, exams: true } },
      },
      orderBy: [{ academicYear: 'desc' }, { name: 'asc' }],
    });
  }

  async updateClassroom(user: AuthUser, id: string, dto: UpdateClassroomDto) {
    const classroom = await this.requireManagedClassroom(user, id);
    await this.ensureClassroomNameAvailable(
      user.organizationId,
      dto.name ?? classroom.name,
      dto.academicYear ?? classroom.academicYear,
      classroom.id,
    );
    const teacherId =
      user.role === UserRole.TEACHER
        ? user.sub
        : (dto.teacherId ?? classroom.teacherId);
    const teacher = await this.prisma.user.findFirst({
      where: {
        id: teacherId,
        organizationId: user.organizationId,
        role: { in: [UserRole.TEACHER, UserRole.ADMIN] },
        isActive: true,
      },
    });
    if (!teacher) throw new BadRequestException('Teacher not found');
    return this.prisma.classroom.update({
      where: { id: classroom.id },
      data: {
        name: dto.name,
        gradeLevel: dto.gradeLevel,
        academicYear: dto.academicYear,
        teacherId,
      },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { enrollments: true, exams: true } },
      },
    });
  }

  async removeClassroom(user: AuthUser, id: string) {
    const classroom = await this.requireManagedClassroom(user, id);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId: classroom.id },
      select: { student: { select: { userId: true } } },
    });
    const userIds = enrollments.map((item) => item.student.userId);
    await this.prisma.$transaction([
      this.prisma.exam.updateMany({
        where: { classroomId: classroom.id },
        data: { status: ExamStatus.ARCHIVED },
      }),
      this.prisma.enrollment.deleteMany({
        where: { classroomId: classroom.id },
      }),
      this.prisma.user.updateMany({
        where: {
          id: { in: userIds },
          organizationId: user.organizationId,
          role: UserRole.STUDENT,
        },
        data: { isActive: false },
      }),
      this.prisma.classroom.update({
        where: { id: classroom.id },
        data: { isActive: false },
      }),
    ]);
    return {
      deleted: true,
      id: classroom.id,
      archivedStudents: userIds.length,
    };
  }

  async createTeacher(user: AuthUser, dto: CreatePersonDto) {
    return this.createUser(user.organizationId, dto, UserRole.TEACHER);
  }

  teachers(user: AuthUser) {
    return this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        role: UserRole.TEACHER,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        createdAt: true,
        _count: { select: { taughtClasses: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async createStudent(user: AuthUser, dto: CreateStudentDto) {
    if (user.role === UserRole.TEACHER && !dto.classroomId)
      throw new BadRequestException('Teacher must select a managed classroom');
    if (dto.classroomId)
      await this.requireManagedClassroom(user, dto.classroomId);
    return this.prisma.$transaction(async (tx) => {
      const created = await this.createStudentWithTx(
        tx,
        user.organizationId,
        dto,
      );
      if (dto.classroomId) {
        await tx.enrollment.create({
          data: { classroomId: dto.classroomId, studentId: created.profileId },
        });
      }
      return created.user;
    });
  }

  students(user: AuthUser, classroomId?: string) {
    return this.prisma.studentProfile.findMany({
      where: {
        organizationId: user.organizationId,
        user: { isActive: true },
        ...(user.role === UserRole.TEACHER
          ? {
              enrollments: {
                some: {
                  ...(classroomId ? { classroomId } : {}),
                  classroom: { teacherId: user.sub },
                },
              },
            }
          : classroomId
            ? { enrollments: { some: { classroomId } } }
            : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        },
        enrollments: {
          ...(user.role === UserRole.TEACHER
            ? { where: { classroom: { teacherId: user.sub } } }
            : {}),
          include: { classroom: { select: { id: true, name: true } } },
        },
      },
      orderBy: { studentCode: 'asc' },
    });
  }

  async updateStudent(user: AuthUser, id: string, dto: UpdateStudentDto) {
    const student = await this.requireManagedStudent(user, id);
    if (dto.classroomId) {
      await this.requireManagedClassroom(user, dto.classroomId);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: student.userId },
        data: {
          email: dto.email?.toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash: dto.password
            ? await bcrypt.hash(dto.password, 12)
            : undefined,
        },
      });
      await tx.studentProfile.update({
        where: { id: student.id },
        data: {
          studentCode: dto.studentCode,
          gradeLevel: dto.gradeLevel,
        },
      });
      if (dto.classroomId !== undefined) {
        await tx.enrollment.deleteMany({ where: { studentId: student.id } });
        if (dto.classroomId) {
          await tx.enrollment.create({
            data: { classroomId: dto.classroomId, studentId: student.id },
          });
        }
      }
      return tx.studentProfile.findUnique({
        where: { id: student.id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
            },
          },
          enrollments: {
            include: { classroom: { select: { id: true, name: true } } },
          },
        },
      });
    });
  }

  async removeStudent(user: AuthUser, id: string) {
    const student = await this.requireManagedStudent(user, id);
    await this.prisma.$transaction([
      this.prisma.enrollment.deleteMany({ where: { studentId: student.id } }),
      this.prisma.user.update({
        where: { id: student.userId },
        data: { isActive: false },
      }),
    ]);
    return { deleted: true, id: student.id };
  }

  async importStudents(
    user: AuthUser,
    classroomId: string,
    file: Express.Multer.File,
  ) {
    await this.requireManagedClassroom(user, classroomId);
    if (!file?.buffer) throw new BadRequestException('Excel file is required');

    let rows: StudentSheetRow[];
    try {
      const sheetRows = await readSheet(file.buffer);
      const headers = (sheetRows[0] ?? []).map((cell) =>
        String(cell ?? '')
          .trim()
          .toLowerCase(),
      );
      rows = sheetRows
        .slice(1)
        .map((cells) =>
          Object.fromEntries(
            headers.map((header, index) => [header, cells[index] ?? '']),
          ),
        );
    } catch {
      throw new BadRequestException('Unable to read Excel file');
    }
    if (!rows.length)
      throw new BadRequestException('Excel file has no data rows');
    if (rows.length > 5000)
      throw new BadRequestException('Maximum 5,000 students per import');

    const imported: Array<{
      row: number;
      studentCode: string;
      email: string;
      temporaryPassword: string;
    }> = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const password =
        this.cellText(row.password) || randomBytes(8).toString('base64url');
      const dto = {
        studentCode: this.cellText(row.student_code),
        firstName: this.cellText(row.first_name),
        lastName: this.cellText(row.last_name),
        email: this.cellText(row.email).toLowerCase(),
        gradeLevel: this.cellText(row.grade_level) || undefined,
        password,
      };
      if (!dto.studentCode || !dto.firstName || !dto.lastName || !dto.email) {
        errors.push({ row: rowNumber, message: 'Missing required column' });
        continue;
      }
      if (!isEmail(dto.email) || password.length < 8) {
        errors.push({
          row: rowNumber,
          message: 'Invalid email or password shorter than 8 characters',
        });
        continue;
      }
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const created = await this.createStudentWithTx(
            tx,
            user.organizationId,
            dto,
          );
          await tx.enrollment.create({
            data: { classroomId, studentId: created.profileId },
          });
          return created;
        });
        imported.push({
          row: rowNumber,
          studentCode: result.user.studentProfile!.studentCode,
          email: result.user.email,
          temporaryPassword: password,
        });
      } catch (error) {
        errors.push({
          row: rowNumber,
          message:
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
              ? 'Email or student code already exists'
              : 'Import failed',
        });
      }
    }
    return {
      total: rows.length,
      importedCount: imported.length,
      imported,
      errors,
    };
  }

  private async createUser(
    organizationId: string,
    dto: CreatePersonDto,
    role: UserRole,
  ) {
    try {
      return await this.prisma.user.create({
        data: {
          organizationId,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 12),
          firstName: dto.firstName,
          lastName: dto.lastName,
          role,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Email already exists');
      throw error;
    }
  }

  private async createStudentWithTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: CreateStudentDto,
  ) {
    const user = await tx.user.create({
      data: {
        organizationId,
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.STUDENT,
        studentProfile: {
          create: {
            organizationId,
            studentCode: dto.studentCode,
            gradeLevel: dto.gradeLevel,
          },
        },
      },
      include: { studentProfile: true },
    });
    return { user, profileId: user.studentProfile!.id };
  }

  private async requireSubject(organizationId: string, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, organizationId },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  private async requireIndicator(organizationId: string, id: string) {
    const indicator = await this.prisma.indicator.findFirst({
      where: { id, organizationId },
    });
    if (!indicator) throw new NotFoundException('Indicator not found');
    return indicator;
  }

  private async requireManagedClassroom(user: AuthUser, id: string) {
    const classroom = await this.prisma.classroom.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        isActive: true,
        ...(user.role === UserRole.TEACHER ? { teacherId: user.sub } : {}),
      },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    return classroom;
  }

  private async requireManagedStudent(user: AuthUser, id: string) {
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        user: { isActive: true },
        ...(user.role === UserRole.TEACHER
          ? { enrollments: { some: { classroom: { teacherId: user.sub } } } }
          : {}),
      },
      select: { id: true, userId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async ensureClassroomNameAvailable(
    organizationId: string,
    name: string,
    academicYear: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.classroom.findFirst({
      where: {
        organizationId,
        name,
        academicYear,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        'Classroom name already exists in this academic year',
      );
  }

  private cellText(value: unknown) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    )
      return '';
    return String(value).trim();
  }
}
