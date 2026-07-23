import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ExamsController } from './exams.controller';
import { AdaptiveService } from './adaptive.service';
import { ExamsService } from './exams.service';

@Module({
  imports: [AiModule],
  controllers: [ExamsController],
  providers: [ExamsService, AdaptiveService],
})
export class ExamsModule {}
