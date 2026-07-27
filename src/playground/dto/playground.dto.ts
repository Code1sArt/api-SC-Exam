import { CodeLanguage } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
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
