import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AcademicModule } from './academic/academic.module';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ExamsModule } from './exams/exams.module';
import { PrismaModule } from './prisma/prisma.module';
import { PlatformModule } from './platform/platform.module';
import { PlaygroundModule } from './playground/playground.module';
import { QuestionsModule } from './questions/questions.module';
import { RecordsModule } from './records/records.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      getTracker: (request) => {
        const { headers, ip } = request as {
          headers?: Record<string, string | string[] | undefined>;
          ip?: string;
        };
        const authorization = headers?.authorization;
        // Students in the same school commonly share one public IP. Once a
        // bearer token is present, rate-limit that authenticated session rather
        // than combining the whole classroom into the same IP quota.
        if (
          typeof authorization === 'string' &&
          authorization.startsWith('Bearer ')
        )
          return authorization;
        return ip ?? 'unknown';
      },
    }),
    PrismaModule,
    PlatformModule,
    AuthModule,
    AcademicModule,
    AiModule,
    QuestionsModule,
    ExamsModule,
    AnalyticsModule,
    AssignmentsModule,
    PlaygroundModule,
    RecordsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
