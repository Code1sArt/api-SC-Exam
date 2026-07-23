import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'STU001',
    description: 'อีเมลสำหรับผู้ดูแล/ครู หรือรหัสประจำตัวนักเรียน',
  })
  @IsOptional()
  @IsString()
  identifier?: string;

  // Kept for backwards compatibility with existing clients.
  @ApiProperty({ required: false, example: 'admin@example.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ required: false, example: 'STU001' })
  @IsOptional()
  @IsString()
  studentCode?: string;

  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  @MinLength(8)
  password!: string;
}
