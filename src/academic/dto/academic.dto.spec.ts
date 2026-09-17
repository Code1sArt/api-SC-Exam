import { validate } from 'class-validator';
import { CreateStudentDto, UpdateStudentDto } from './academic.dto';

describe('student number validation', () => {
  const createDto = (studentNumber: number) =>
    Object.assign(new CreateStudentDto(), {
      email: 'student@example.com',
      password: 'Password123!',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      studentCode: 'STU001',
      classroomId: 'classroom-1',
      studentNumber,
    });

  it('accepts a positive integer student number', async () => {
    await expect(validate(createDto(1))).resolves.toHaveLength(0);
  });

  it.each([0, -1, 1.5, 10_000])(
    'rejects invalid student number %s',
    async (studentNumber) => {
      expect(await validate(createDto(studentNumber))).not.toHaveLength(0);
    },
  );

  it('allows null when clearing a student number', async () => {
    const dto = Object.assign(new UpdateStudentDto(), { studentNumber: null });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
