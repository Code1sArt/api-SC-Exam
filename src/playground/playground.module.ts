import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { PlaygroundController } from './playground.controller';
import { PlaygroundService } from './playground.service';

@Module({
  imports: [AiModule, AssignmentsModule],
  controllers: [PlaygroundController],
  providers: [PlaygroundService],
})
export class PlaygroundModule {}
