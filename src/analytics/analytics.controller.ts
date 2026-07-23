import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('Teacher dashboard and analytics')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.TEACHER)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: AuthUser,
    @Query('classroomId') classroomId?: string,
  ) {
    return this.analytics.dashboard(user, classroomId);
  }

  @Get('exams/:examId')
  examResults(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    return this.analytics.examResults(user, examId);
  }

  @Get('indicators')
  indicatorMastery(
    @CurrentUser() user: AuthUser,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.analytics.indicatorMastery(user, subjectId);
  }
}
