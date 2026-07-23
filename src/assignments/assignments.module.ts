import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { AiModule } from '../ai/ai.module';
import { CodeRunnerService } from './code-runner.service';

@Module({
  imports: [AiModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, CodeRunnerService],
})
export class AssignmentsModule {}
