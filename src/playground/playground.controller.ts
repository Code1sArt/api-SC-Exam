import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import {
  PlaygroundAdviceDto,
  RunPlaygroundCodeDto,
  UpdatePlaygroundAccessDto,
} from './dto/playground.dto';
import { PlaygroundService } from './playground.service';

@ApiTags('Student playground')
@ApiBearerAuth()
@Controller('playground')
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Get('status')
  @Roles(UserRole.STUDENT, UserRole.ADMIN)
  status(@CurrentUser() user: AuthUser) {
    return this.playground.status(user.organizationId);
  }

  @Patch('access')
  @Roles(UserRole.ADMIN)
  setAccess(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePlaygroundAccessDto,
  ) {
    return this.playground.setEnabled(user.organizationId, dto.enabled);
  }

  @Post('run')
  @Roles(UserRole.STUDENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser, @Body() dto: RunPlaygroundCodeDto) {
    return this.playground.run(user, dto);
  }

  @Post('advice')
  @Roles(UserRole.STUDENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  advice(@CurrentUser() user: AuthUser, @Body() dto: PlaygroundAdviceDto) {
    return this.playground.advice(user, dto);
  }
}
