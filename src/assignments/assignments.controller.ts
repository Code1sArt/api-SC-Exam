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
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AssignmentsService } from './assignments.service';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  RunCodeDto,
  RunStoredCodeDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
  UpdateGradeScaleDto,
} from './dto/assignment.dto';

@ApiTags('Assignments and grading')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get() list(@CurrentUser() user: AuthUser) {
    return this.assignments.list(user);
  }

  @Get('grade-scale')
  gradeScale(@CurrentUser() user: AuthUser) {
    return this.assignments.gradeScale(user);
  }

  @Patch('grade-scale')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateGradeScale(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateGradeScaleDto,
  ) {
    return this.assignments.updateGradeScale(user, dto.grades);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.assignments.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignments.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assignments.remove(user, id);
  }

  @Post(':id/submit')
  @Roles(UserRole.STUDENT)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SubmitAssignmentDto,
  ) {
    return this.assignments.submit(user, id, dto);
  }

  @Post(':id/run-code')
  @Roles(UserRole.STUDENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  runCode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RunCodeDto,
  ) {
    return this.assignments.runCode(user, id, dto);
  }

  @Post(':id/submissions/:submissionId/run-code')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  runSubmissionCode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: RunStoredCodeDto,
  ) {
    return this.assignments.runSubmissionCode(user, id, submissionId, dto);
  }

  @Patch(':id/submissions/:submissionId/grade')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  grade(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.assignments.grade(user, id, submissionId, dto);
  }
}
