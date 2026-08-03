import { CodeLanguage } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class RunPlaygroundCodeDto {
  @IsEnum(CodeLanguage)
  language!: CodeLanguage;

  @IsString()
  @Length(1, 20000)
  sourceCode!: string;

  @IsOptional()
  @IsString()
  @Length(0, 10000)
  stdin?: string;
}

export class PlaygroundAdviceDto {
  @IsEnum(CodeLanguage)
  language!: CodeLanguage;

  @IsString()
  @Length(1, 20000)
  sourceCode!: string;
}

export class UpdatePlaygroundAccessDto {
  @IsBoolean()
  enabled!: boolean;
}

export enum PlaygroundProblemDifficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export class CreatePlaygroundProblemDto {
  @IsString()
  @Length(1, 160)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsEnum(PlaygroundProblemDifficulty)
  difficulty!: PlaygroundProblemDifficulty;

  @IsString()
  @Length(1, 2048)
  driveUrl!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;
}

export class UpdatePlaygroundProblemDto extends CreatePlaygroundProblemDto {}
