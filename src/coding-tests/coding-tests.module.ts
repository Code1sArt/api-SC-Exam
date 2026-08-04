import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { CodingTestsController } from './coding-tests.controller';
import { CodingTestsService } from './coding-tests.service';

@Module({
  imports: [AiModule, AssignmentsModule],
  controllers: [CodingTestsController],
  providers: [CodingTestsService],
})
export class CodingTestsModule {}
