import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsInt,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExamItemDto {
  @IsString()
  questionId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  score!: number;
}

export class CreateExamDto {
  @IsOptional()
  @IsString()
  classroomId?: string;

  @ApiPropertyOptional({
    description: 'Create the same exam for multiple classrooms at once',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  classroomIds?: string[];

  @IsString()
  subjectId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsBoolean()
  isAdaptive = false;

  @ApiProperty({
    description: 'Number of questions each student actually receives',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  questionCount!: number;

  @ApiPropertyOptional({
    description:
      'Number of essay questions randomly assigned; null/omitted assigns all selected essays',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  essayQuestionCount?: number | null;

  @ApiPropertyOptional({
    description: 'Exact number of delivered questions for each question type',
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 0 },
  })
  @IsOptional()
  @IsObject()
  questionTypeCounts?: Record<string, number>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: '2026-08-01T02:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  availableFrom?: string;

  @IsOptional()
  @IsDateString()
  availableUntil?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts = 1;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExamItemDto)
  items!: ExamItemDto[];
}

export class UpdateExamDto extends PartialType(CreateExamDto) {}

export class SubmitAnswerDto {
  @ApiProperty({ description: 'JSON response; e.g. { selectedOptionId: "A" }' })
  @IsDefined()
  response!: unknown;
}

export class SetExamAvailabilityDto {
  @ApiProperty({ description: 'True opens the exam; false closes it' })
  @IsBoolean()
  isOpen!: boolean;
}

export const EXAM_VIOLATION_TYPES = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'COPY',
  'PASTE',
  'CUT',
  'PAGE_EXIT',
] as const;

export class ReportExamViolationDto {
  @ApiProperty({ enum: EXAM_VIOLATION_TYPES })
  @IsIn(EXAM_VIOLATION_TYPES)
  type!: (typeof EXAM_VIOLATION_TYPES)[number];
}
