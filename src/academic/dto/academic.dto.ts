import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class CreateSubjectDto {
  @ApiProperty({ example: 'MATH' })
  @IsString()
  @Length(1, 30)
  code!: string;

  @ApiProperty({ example: 'คณิตศาสตร์' })
  @IsString()
  @Length(2, 150)
  name!: string;
}

export class CreateIndicatorDto {
  @IsString()
  subjectId!: string;

  @ApiProperty({ example: 'ค 1.1 ม.1/1' })
  @IsString()
  @Length(1, 100)
  code!: string;

  @IsString()
  @Length(2, 2000)
  description!: string;

  @ApiPropertyOptional({ example: 'ม.1' })
  @IsOptional()
  @IsString()
  gradeLevel?: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

export class UpdateIndicatorDto extends PartialType(CreateIndicatorDto) {}

export class CreateClassroomDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 30)
  academicYear!: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @ApiPropertyOptional({ description: 'Defaults to the current teacher' })
  @IsOptional()
  @IsString()
  teacherId?: string;
}

export class UpdateClassroomDto extends PartialType(CreateClassroomDto) {}

export class CreatePersonDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;
}

export class CreateStudentDto extends CreatePersonDto {
  @IsString()
  @Length(1, 50)
  studentCode!: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @IsOptional()
  @IsString()
  classroomId?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  studentCode?: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  classroomId?: string | null;
}
