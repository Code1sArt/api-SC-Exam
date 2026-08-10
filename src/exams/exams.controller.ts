import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import {
  CreateExamDto,
  ReportExamViolationDto,
  SetExamAvailabilityDto,
  SubmitAnswerDto,
  UpdateExamAttemptScoreDto,
  UpdateExamDto,
  UpdateExamResultMaxScoreDto,
} from './dto/exam.dto';
import { ExamsService } from './exams.service';

@ApiTags('Online exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.exams.list(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExamDto) {
    return this.exams.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExamDto,
  ) {
    return this.exams.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.remove(user, id);
  }

  @Post(':id/publish')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.publish(user, id);
  }

  @Patch(':id/availability')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  setAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetExamAvailabilityDto,
  ) {
    return this.exams.setAvailability(user, id, dto.isOpen);
  }

  @Patch(':id/result-max-score')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateResultMaxScore(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExamResultMaxScoreDto,
  ) {
    return this.exams.updateResultMaxScore(user, id, dto.maxScore);
  }

  @Patch(':id/attempts/:attemptId/score')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateAttemptScore(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
    @Body() dto: UpdateExamAttemptScoreDto,
  ) {
    return this.exams.updateAttemptScore(user, id, attemptId, dto.score);
  }

  @Post(':id/students/:studentId/score')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  createStudentScore(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() dto: UpdateExamAttemptScoreDto,
  ) {
    return this.exams.createStudentScore(user, id, studentId, dto.score);
  }

  @Post(':id/start')
  @Roles(UserRole.STUDENT)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.start(user, id);
  }

  @Delete(':id/attempts/:attemptId')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  resetAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
  ) {
    return this.exams.resetAttempt(user, id, attemptId);
  }

  @Get('reset-attempts')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  resetAttempts(@CurrentUser() user: AuthUser) {
    return this.exams.resetAttempts(user);
  }

  @Post('reset-attempts/:archiveId/restore')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  restoreResetAttempt(
    @CurrentUser() user: AuthUser,
    @Param('archiveId') archiveId: string,
  ) {
    return this.exams.restoreResetAttempt(user, archiveId);
  }

  @Get('attempts/:attemptId/next')
  @Roles(UserRole.STUDENT)
  next(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.exams.nextQuestion(user, attemptId);
  }

  @Get('attempts/:attemptId/status')
  @Roles(UserRole.STUDENT)
  attemptStatus(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
  ) {
    return this.exams.attemptStatus(user, attemptId);
  }

  @Post('attempts/:attemptId/violation')
  @Roles(UserRole.STUDENT)
  reportViolation(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: ReportExamViolationDto,
  ) {
    return this.exams.reportViolation(user, attemptId, dto.type);
  }

  @Get('locked-attempts')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  lockedAttempts(@CurrentUser() user: AuthUser) {
    return this.exams.lockedAttempts(user);
  }

  @Post('attempts/:attemptId/unlock')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  unlockAttempt(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
  ) {
    return this.exams.unlockAttempt(user, attemptId);
  }

  @Get('attempts/:attemptId/result')
  @Roles(UserRole.STUDENT)
  result(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.exams.attemptResult(user, attemptId);
  }

  @Post('attempts/:attemptId/questions/:questionId/answer')
  @Roles(UserRole.STUDENT)
  answer(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.exams.answer(user, attemptId, questionId, dto);
  }

  @Post('attempts/:attemptId/submit')
  @Roles(UserRole.STUDENT)
  submit(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.exams.submit(user, attemptId);
  }
}
