import { Body, Controller, Get, Param, Patch, Post, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CodingTestsService } from './coding-tests.service';
import { CodingViolationDto, CreateCodingTestDto, GradeCodingAttemptDto, RunCodingTestDto, SetCodingAvailabilityDto, SubmitCodingTestDto, UpdateCodingTestDto } from './dto/coding-test.dto';

@ApiTags('Coding tests')
@ApiBearerAuth()
@Controller('coding-tests')
export class CodingTestsController {
  constructor(private readonly codingTests: CodingTestsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.codingTests.list(user); }
  @Post() @Roles(UserRole.ADMIN, UserRole.TEACHER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCodingTestDto) { return this.codingTests.create(user, dto); }
  @Patch(':id') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCodingTestDto) { return this.codingTests.update(user, id, dto); }
  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.codingTests.remove(user, id); }
  @Delete(':id/attempts/:attemptId') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  resetAttempt(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('attemptId') attemptId: string) { return this.codingTests.resetAttempt(user, id, attemptId); }
  @Patch(':id/availability') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  availability(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetCodingAvailabilityDto) { return this.codingTests.setAvailability(user, id, dto.isOpen); }
  @Post(':id/start') @Roles(UserRole.STUDENT)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.codingTests.start(user, id); }
  @Post('attempts/:attemptId/submit') @Roles(UserRole.STUDENT)
  submit(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string, @Body() dto: SubmitCodingTestDto) { return this.codingTests.submit(user, attemptId, dto); }
  @Get('attempts/:attemptId/status')
  status(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) { return this.codingTests.status(user, attemptId); }
  @Post('attempts/:attemptId/violation') @Roles(UserRole.STUDENT)
  violation(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string, @Body() dto: CodingViolationDto) { return this.codingTests.reportViolation(user, attemptId, dto.type); }
  @Post('attempts/:attemptId/unlock') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  unlock(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) { return this.codingTests.unlock(user, attemptId); }
  @Patch('attempts/:attemptId/grade') @Roles(UserRole.ADMIN, UserRole.TEACHER)
  grade(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string, @Body() dto: GradeCodingAttemptDto) { return this.codingTests.grade(user, attemptId, dto); }
  @Post(':id/run-code') @Roles(UserRole.STUDENT) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RunCodingTestDto) { return this.codingTests.run(user, id, dto); }
}
