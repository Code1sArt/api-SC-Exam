import { IsBoolean } from 'class-validator';

export class UpdateStudentAiAccessDto {
  @IsBoolean()
  enabled!: boolean;
}
