import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeLanguage } from '@prisma/client';

type RuntimeConfig = {
  language: string;
  versionKey: string;
  defaultVersion: string;
  filename: string;
};

const RUNTIMES: Record<CodeLanguage, RuntimeConfig> = {
  C: {
    language: 'c',
    versionKey: 'PISTON_C_VERSION',
    defaultVersion: '10.2.0',
    filename: 'main.c',
  },
  CPP: {
    language: 'c++',
    versionKey: 'PISTON_CPP_VERSION',
    defaultVersion: '10.2.0',
    filename: 'main.cpp',
  },
  CSHARP: {
    language: 'csharp',
    versionKey: 'PISTON_CSHARP_VERSION',
    defaultVersion: '6.12.0',
    filename: 'Main.cs',
  },
  PYTHON: {
    language: 'python',
    versionKey: 'PISTON_PYTHON_VERSION',
    defaultVersion: '3.12.0',
    filename: 'main.py',
  },
};

type PistonStage = {
  stdout?: string;
  stderr?: string;
  output?: string;
  code?: number | null;
  signal?: string | null;
  status?: string | null;
  message?: string | null;
  memory?: number;
  cpu_time?: number;
};

type PistonResult = {
  compile?: PistonStage;
  run?: PistonStage;
  message?: string;
};

const MAX_CONCURRENT_RUNS = 2;

@Injectable()
export class CodeRunnerService {
  private activeRuns = 0;
  private readonly waitingRuns: Array<() => void> = [];

  constructor(private readonly config: ConfigService) {}

  async run(language: CodeLanguage, sourceCode: string, stdin?: string) {
    const release = await this.acquireRunSlot();

    try {
      return await this.execute(language, sourceCode, stdin);
    } finally {
      release();
    }
  }

  private async execute(
    language: CodeLanguage,
    sourceCode: string,
    stdin?: string,
  ) {
    const baseUrl = this.config
      .get<string>('PISTON_BASE_URL')
      ?.replace(/\/$/, '');
    if (!baseUrl)
      throw new ServiceUnavailableException(
        'ระบบทดลองรันโค้ดยังไม่ได้ตั้งค่า Piston',
      );

    const runtime = RUNTIMES[language];
    const response = await this.request(`${baseUrl}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        language: runtime.language,
        version: this.config.get<string>(
          runtime.versionKey,
          runtime.defaultVersion,
        ),
        files: [{ name: runtime.filename, content: sourceCode }],
        stdin: stdin ?? '',
        compile_timeout: 10_000,
        run_timeout: 3_000,
        compile_memory_limit: 512 * 1024 * 1024,
        run_memory_limit: 128 * 1024 * 1024,
      }),
    });
    const result = (await response.json()) as PistonResult;
    const compileFailed = Boolean(
      result.compile &&
      (result.compile.code !== 0 ||
        result.compile.signal ||
        result.compile.status),
    );
    const timedOut = result.run?.status === 'TO';
    const runFailed = Boolean(
      !compileFailed &&
      result.run &&
      (result.run.code !== 0 || result.run.signal || result.run.status),
    );
    const stage = compileFailed ? result.compile : result.run;

    return {
      statusId: compileFailed ? 6 : timedOut ? 5 : runFailed ? 11 : 3,
      status: compileFailed
        ? 'Compile ไม่ผ่าน'
        : timedOut
          ? 'ใช้เวลาเกินกำหนด'
          : runFailed
            ? 'Runtime Error'
            : 'สำเร็จ',
      stdout: result.run?.stdout ?? '',
      stderr: result.run?.stderr ?? '',
      compileOutput: compileFailed ? (result.compile?.output ?? '') : '',
      message: stage?.message ?? result.message ?? '',
      time: typeof stage?.cpu_time === 'number' ? stage.cpu_time / 1000 : null,
      memory:
        typeof stage?.memory === 'number'
          ? Math.ceil(stage.memory / 1024)
          : null,
    };
  }

  private async acquireRunSlot() {
    if (this.activeRuns < MAX_CONCURRENT_RUNS) {
      this.activeRuns += 1;
      return () => this.releaseRunSlot();
    }

    await new Promise<void>((resolve) => this.waitingRuns.push(resolve));
    return () => this.releaseRunSlot();
  }

  private releaseRunSlot() {
    const next = this.waitingRuns.shift();
    if (next) {
      next();
      return;
    }

    this.activeRuns -= 1;
  }

  private async request(url: string, options: RequestInit) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new BadGatewayException(
          `Piston ตอบกลับ ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        error instanceof Error
          ? `เชื่อมต่อ Piston ไม่สำเร็จ: ${error.message}`
          : 'เชื่อมต่อ Piston ไม่สำเร็จ',
      );
    }
  }
}
