import { PartialType } from '@nestjs/swagger';
import { CodeLanguage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CodingTestCaseDto {
  @IsString() @Length(0, 10000) input!: string;
  @IsString() @Length(0, 10000) expectedOutput!: string;
}

export class CodingProblemDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(1, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsUrl({ require_protocol: true }) @Length(1, 2048) pdfUrl!: string;
  @IsEnum(CodeLanguage) language!: CodeLanguage;
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(1000) score!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CodingTestCaseDto)
  testCases!: CodingTestCaseDto[];
}

export class CreateCodingTestDto {
  @IsString() classroomId!: string;
  @IsString() subjectId!: string;
  @IsString() @Length(2, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 10000) description?: string;
  @Type(() => Number) @IsInt() @Min(1) requiredCount!: number;
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(100000) fullScore!: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;
  @IsOptional() @IsDateString() availableFrom?: string;
  @IsOptional() @IsDateString() availableUntil?: string;
  @IsOptional() @IsBoolean() aiGradingEnabled?: boolean;
  @IsOptional() @IsString() @Length(1, 200) aiGradingModel?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CodingProblemDto)
  problems!: CodingProblemDto[];
}

export class UpdateCodingTestDto extends PartialType(CreateCodingTestDto) {}

export class CodingAnswerDto {
  @IsString() problemId!: string;
  @IsString() @Length(1, 20000) sourceCode!: string;
}

export class SubmitCodingTestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CodingAnswerDto)
  answers!: CodingAnswerDto[];
}

export class CodingViolationDto {
  @IsIn(['TAB_HIDDEN', 'WINDOW_BLUR', 'COPY', 'PASTE', 'CUT', 'PAGE_EXIT'])
  type!: string;
}

export class CodingAnswerGradeDto {
  @IsString() answerId!: string;
  @Type(() => Number) @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() @Length(0, 10000) feedback?: string;
}

export class GradeCodingAttemptDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CodingAnswerGradeDto)
  answers!: CodingAnswerGradeDto[];
}

export class RunCodingTestDto {
  @IsString() problemId!: string;
  @IsString() @Length(1, 20000) sourceCode!: string;
  @IsOptional() @IsString() @Length(0, 10000) stdin?: string;
}

export class SetCodingAvailabilityDto {
  @IsBoolean() isOpen!: boolean;
}
