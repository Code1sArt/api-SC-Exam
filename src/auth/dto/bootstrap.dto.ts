import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class BootstrapDto {
  @ApiProperty({ example: 'โรงเรียนตัวอย่าง' })
  @IsString()
  @Length(2, 150)
  organizationName!: string;

  @ApiProperty({ example: 'DEMO-SCHOOL' })
  @IsString()
  @Length(2, 50)
  organizationCode!: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin123!' })
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
