import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AcademicService } from './academic.service';
import {
  CreateClassroomDto,
  CreateIndicatorDto,
  CreatePersonDto,
  CreateStudentDto,
  CreateSubjectDto,
  UpdateClassroomDto,
  UpdateIndicatorDto,
  UpdateStudentDto,
  UpdateSubjectDto,
} from './dto/academic.dto';

@ApiTags('Academic management')
@ApiBearerAuth()
@Controller('academic')
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get('subjects')
  subjects(@CurrentUser() user: AuthUser) {
    return this.academic.subjects(user);
  }

  @Post('subjects')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  createSubject(@CurrentUser() user: AuthUser, @Body() dto: CreateSubjectDto) {
    return this.academic.createSubject(user, dto);
  }

  @Patch('subjects/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateSubject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.academic.updateSubject(user, id, dto);
  }

  @Delete('subjects/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  removeSubject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.academic.removeSubject(user, id);
  }

  @Get('indicators')
  indicators(
    @CurrentUser() user: AuthUser,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.academic.indicators(user, subjectId);
  }

  @Post('indicators')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  createIndicator(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateIndicatorDto,
  ) {
    return this.academic.createIndicator(user, dto);
  }

  @Patch('indicators/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateIndicator(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIndicatorDto,
  ) {
    return this.academic.updateIndicator(user, id, dto);
  }

  @Delete('indicators/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  removeIndicator(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.academic.removeIndicator(user, id);
  }

  @Get('classrooms')
  classrooms(@CurrentUser() user: AuthUser) {
    return this.academic.classrooms(user);
  }

  @Post('classrooms')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  createClassroom(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateClassroomDto,
  ) {
    return this.academic.createClassroom(user, dto);
  }

  @Patch('classrooms/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateClassroom(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateClassroomDto,
  ) {
    return this.academic.updateClassroom(user, id, dto);
  }

  @Delete('classrooms/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  removeClassroom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.academic.removeClassroom(user, id);
  }

  @Post('teachers')
  @Roles(UserRole.ADMIN)
  createTeacher(@CurrentUser() user: AuthUser, @Body() dto: CreatePersonDto) {
    return this.academic.createTeacher(user, dto);
  }

  @Get('teachers')
  @Roles(UserRole.ADMIN)
  teachers(@CurrentUser() user: AuthUser) {
    return this.academic.teachers(user);
  }

  @Get('students')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  students(
    @CurrentUser() user: AuthUser,
    @Query('classroomId') classroomId?: string,
  ) {
    return this.academic.students(user, classroomId);
  }

  @Post('students')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  createStudent(@CurrentUser() user: AuthUser, @Body() dto: CreateStudentDto) {
    return this.academic.createStudent(user, dto);
  }

  @Patch('students/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  updateStudent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.academic.updateStudent(user, id, dto);
  }

  @Delete('students/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  removeStudent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.academic.removeStudent(user, id);
  }

  @Post('classrooms/:classroomId/students/import')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  importStudents(
    @CurrentUser() user: AuthUser,
    @Param('classroomId') classroomId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.academic.importStudents(user, classroomId, file);
  }
}
