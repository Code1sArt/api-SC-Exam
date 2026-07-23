import 'dotenv/config';
import {
  Difficulty,
  PrismaClient,
  QuestionSource,
  QuestionType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: { code: 'DEMO', name: 'โรงเรียนสาธิต SC Exam' },
  });
  const passwordHash = await bcrypt.hash('Demo1234!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.local' },
    update: {},
    create: {
      organizationId: organization.id,
      email: 'admin@demo.local',
      passwordHash,
      firstName: 'ผู้ดูแล',
      lastName: 'ระบบ',
      role: UserRole.SUPER_ADMIN,
    },
  });
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@demo.local' },
    update: {},
    create: {
      organizationId: organization.id,
      email: 'teacher@demo.local',
      passwordHash,
      firstName: 'ครู',
      lastName: 'ตัวอย่าง',
      role: UserRole.TEACHER,
    },
  });
  const student = await prisma.user.upsert({
    where: { email: 'student@demo.local' },
    update: {},
    create: {
      organizationId: organization.id,
      email: 'student@demo.local',
      passwordHash,
      firstName: 'นักเรียน',
      lastName: 'ตัวอย่าง',
      role: UserRole.STUDENT,
      studentProfile: {
        create: {
          organizationId: organization.id,
          studentCode: 'STU001',
          gradeLevel: 'ม.1',
        },
      },
    },
    include: { studentProfile: true },
  });
  const subject = await prisma.subject.upsert({
    where: {
      organizationId_code: { organizationId: organization.id, code: 'MATH' },
    },
    update: {},
    create: {
      organizationId: organization.id,
      code: 'MATH',
      name: 'คณิตศาสตร์',
    },
  });
  const indicator = await prisma.indicator.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: 'ค 1.1 ม.1/1',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      subjectId: subject.id,
      code: 'ค 1.1 ม.1/1',
      description: 'เข้าใจจำนวนตรรกยะและความสัมพันธ์ของจำนวนตรรกยะ',
      gradeLevel: 'ม.1',
    },
  });
  const classroom = await prisma.classroom.upsert({
    where: {
      organizationId_name_academicYear: {
        organizationId: organization.id,
        name: 'ม.1/1',
        academicYear: '2569',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      teacherId: teacher.id,
      name: 'ม.1/1',
      gradeLevel: 'ม.1',
      academicYear: '2569',
    },
  });
  if (student.studentProfile) {
    await prisma.enrollment.upsert({
      where: {
        classroomId_studentId: {
          classroomId: classroom.id,
          studentId: student.studentProfile.id,
        },
      },
      update: {},
      create: {
        classroomId: classroom.id,
        studentId: student.studentProfile.id,
      },
    });
  }
  const existingQuestion = await prisma.question.findFirst({
    where: {
      organizationId: organization.id,
      subjectId: subject.id,
      prompt: 'ข้อใดมีค่าเท่ากับ 1/2',
    },
  });
  if (!existingQuestion) {
    await prisma.question.create({
      data: {
        organizationId: organization.id,
        subjectId: subject.id,
        indicatorId: indicator.id,
        createdById: admin.id,
        type: QuestionType.MULTIPLE_CHOICE,
        source: QuestionSource.MANUAL,
        difficulty: Difficulty.EASY,
        prompt: 'ข้อใดมีค่าเท่ากับ 1/2',
        options: [
          { id: 'A', text: '2/3' },
          { id: 'B', text: '2/4' },
          { id: 'C', text: '3/4' },
          { id: 'D', text: '1/3' },
        ],
        answerKey: { correctOptionId: 'B' },
        explanation: '2/4 ย่อส่วนด้วย 2 ได้ 1/2',
        maxScore: 1,
      },
    });
  }
  console.info('Seed complete. Demo password for all users: Demo1234!');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
