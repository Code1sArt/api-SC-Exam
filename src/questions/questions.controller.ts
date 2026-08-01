import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Difficulty, QuestionType, UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import {
  CreateQuestionDto,
  DeleteQuestionsDto,
  GenerateQuestionsDto,
  ImportQuestionsDto,
  RemedialQuestionDto,
  UpdateQuestionDto,
} from './dto/question.dto';
import { QuestionsService } from './questions.service';

@ApiTags('Question bank')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.TEACHER)
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('subjectId') subjectId?: string,
    @Query('indicatorId') indicatorId?: string,
    @Query('type') type?: QuestionType,
    @Query('difficulty') difficulty?: Difficulty,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.questions.findAll(user, {
      subjectId,
      indicatorId,
      type,
      difficulty,
      search,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(500, Math.max(1, Number(limit) || 20)),
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuestionDto) {
    return this.questions.create(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.questions.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questions.update(user, id, dto);
  }

  @Delete()
  removeMany(@CurrentUser() user: AuthUser, @Body() dto: DeleteQuestionsDto) {
    return this.questions.removeMany(user, dto.ids);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.questions.remove(user, id);
  }

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateQuestionsDto) {
    return this.questions.generate(user, dto);
  }

  @Post('import/json')
  importJson(@CurrentUser() user: AuthUser, @Body() dto: ImportQuestionsDto) {
    return this.questions.importJson(user, dto);
  }

  @Post(':id/remedial')
  generateRemedial(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RemedialQuestionDto,
  ) {
    return this.questions.generateRemedial(user, id, dto);
  }
}
