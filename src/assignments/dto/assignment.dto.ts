import { PartialType } from '@nestjs/swagger';
import { AssignmentStatus, AssignmentType, CodeLanguage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  IsBoolean,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AssignmentGroupMemberDto {
  @IsString() studentId!: string;
  @IsString() @Length(1, 200) role!: string;
}

export class MemberGradeDto {
  @IsString() studentId!: string;
  @Type(() => Number) @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() @Length(0, 10000) feedback?: string;
}

export class CreateAssignmentDto {
  @IsString() classroomId!: string;
  @IsString() subjectId!: string;
  @IsString() @Length(2, 200) title!: string;
  @IsString() @Length(1, 10000) description!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(100000) maxScore!: number;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsEnum(AssignmentStatus) status?: AssignmentStatus;
  @IsOptional() @IsEnum(AssignmentType) type?: AssignmentType;
  @IsOptional() @IsEnum(CodeLanguage) codeLanguage?: CodeLanguage;
  @ValidateIf((_, value) => value !== undefined && value !== '')
  @IsUrl({ require_protocol: true })
  @Length(0, 2048)
  problemPdfUrl?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() aiGradingEnabled?: boolean;
  @IsOptional() @IsString() @Length(1, 200) aiGradingModel?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isGroupWork?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  minGroupSize?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  maxGroupSize?: number;
}

export class UpdateAssignmentDto extends PartialType(CreateAssignmentDto) {}

export class SubmitAssignmentDto {
  @IsOptional() @IsString() @Length(1, 20000) content?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) attachmentUrl?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_protocol: true }, { each: true })
  attachmentUrls?: string[];
  @IsOptional() @IsString() @Length(1, 100) groupName?: string;
  @IsOptional() @IsString() @Length(1, 200) submitterRole?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(49)
  @ValidateNested({ each: true })
  @Type(() => AssignmentGroupMemberDto)
  members?: AssignmentGroupMemberDto[];
}

export class RunCodeDto {
  @IsString() @Length(1, 20000) sourceCode!: string;
  @IsOptional() @IsString() @Length(0, 10000) stdin?: string;
}

export class RunStoredCodeDto {
  @IsOptional() @IsString() @Length(0, 10000) stdin?: string;
}

export class GradeSubmissionDto {
  @Type(() => Number) @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() @Length(0, 10000) feedback?: string;
  @IsOptional() @IsEnum(['SHARED', 'INDIVIDUAL']) gradingMode?:
    'SHARED' | 'INDIVIDUAL';
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberGradeDto)
  memberScores?: MemberGradeDto[];
}

export class ClassroomGradeDto {
  @IsString() studentId!: string;
  @Type(() => Number) @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() @Length(0, 10000) feedback?: string;
}

export class GradeClassroomDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ClassroomGradeDto)
  grades!: ClassroomGradeDto[];
}

export class UpdateGradeScaleDto {
  @IsObject() grades!: Record<string, number>;
}
