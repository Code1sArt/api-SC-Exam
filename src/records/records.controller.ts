import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RecordsService } from './records.service';

@ApiTags('Student academic records')
@ApiBearerAuth()
@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('me')
  @Roles(UserRole.STUDENT)
  mine(@CurrentUser() user: AuthUser) {
    return this.records.mine(user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  summary(
    @CurrentUser() user: AuthUser,
    @Query('classroomId') classroomId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.records.summary(user, classroomId, subjectId);
  }
}
