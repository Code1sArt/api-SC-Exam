import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Difficulty, QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuestionOptionDto {
  @IsString()
  id!: string;

  @IsString()
  text!: string;
}

export class CreateQuestionDto {
  @IsString()
  subjectId!: string;

  @IsOptional()
  @IsString()
  indicatorId?: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsEnum(Difficulty)
  difficulty!: Difficulty;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  answerKey!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  explanation?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  maxScore = 1;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class GenerateQuestionsDto {
  @IsString()
  subjectId!: string;

  @IsOptional()
  @IsString()
  indicatorId?: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsEnum(QuestionType, { each: true })
  types!: QuestionType[];

  @IsEnum(Difficulty)
  difficulty!: Difficulty;

  @IsOptional()
  @IsString()
  language = 'ไทย';
}

export class ImportQuestionItemDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  @IsObject()
  answerKey!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  explanation?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  maxScore = 1;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ImportQuestionsDto {
  @IsString()
  subjectCode!: string;

  @IsOptional()
  @IsString()
  indicatorCode?: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsEnum(Difficulty)
  difficulty!: Difficulty;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportQuestionItemDto)
  questions!: ImportQuestionItemDto[];
}

export class UpdateQuestionDto extends PartialType(CreateQuestionDto) {}

export class DeleteQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}

export class RemedialQuestionDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsDefined()
  response!: unknown;

  @IsOptional()
  @IsString()
  feedback?: string;
}
