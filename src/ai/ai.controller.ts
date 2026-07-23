import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { AiService } from './ai.service';
import { UpdateStudentAiAccessDto } from './dto/update-student-ai-access.dto';

@ApiTags('AI configuration')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.TEACHER)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.ai.getStatus(user.organizationId);
  }

  @Get('student-status')
  @Roles(UserRole.STUDENT)
  studentStatus(@CurrentUser() user: AuthUser) {
    return this.ai.getStudentStatus(user.organizationId);
  }

  @Patch('student-access')
  @Roles(UserRole.ADMIN)
  updateStudentAccess(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateStudentAiAccessDto,
  ) {
    return this.ai.setStudentAiEnabled(user.organizationId, dto.enabled);
  }
}
