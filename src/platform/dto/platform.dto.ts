import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOrganizationDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 30)
  code!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  adminFirstName!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  adminLastName!: string;

  @Transform(trim)
  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  adminPassword!: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 30)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAiModelsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  generationModel?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reasoningModel?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reportModel?: string;
}

export class UpdateAiBudgetDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  monthlyTokenBudget!: number;
}
