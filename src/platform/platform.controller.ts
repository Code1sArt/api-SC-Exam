import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import {
  CreateOrganizationDto,
  UpdateAiModelsDto,
  UpdateAiBudgetDto,
  UpdateOrganizationDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@ApiTags('Super admin platform management')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('organizations')
  listOrganizations() {
    return this.platform.listOrganizations();
  }

  @Get('ai-models/catalog')
  getAiModelCatalog() {
    return this.platform.getAiModelCatalog();
  }

  @Post('organizations')
  createOrganization(@Body() dto: CreateOrganizationDto) {
    return this.platform.createOrganization(dto);
  }

  @Patch('organizations/:id')
  updateOrganization(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.platform.updateOrganization(id, dto);
  }

  @Patch('organizations/:id/ai-models')
  updateAiModels(@Param('id') id: string, @Body() dto: UpdateAiModelsDto) {
    return this.platform.updateAiModels(id, dto);
  }

  @Get('ai-usage')
  getAiUsage() {
    return this.platform.getAiUsage();
  }

  @Patch('organizations/:id/ai-budget')
  updateAiBudget(@Param('id') id: string, @Body() dto: UpdateAiBudgetDto) {
    return this.platform.updateAiBudget(id, dto.monthlyTokenBudget);
  }
}
