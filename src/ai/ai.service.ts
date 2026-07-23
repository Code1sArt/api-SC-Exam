import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiStatus,
  AiTask,
  Difficulty,
  Prisma,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GeneratedQuestion, GradeResult, LearningReport } from './ai.types';

interface AiContext {
  organizationId: string;
  requestedById?: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface AiOperationResult<T> {
  output: T;
  tokenUsage?: TokenUsage;
}

@Injectable()
export class AiService {
  private readonly studentStatusCache = new Map<
    string,
    {
      expiresAt: number;
      value: {
        status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'MOCK' | 'DISABLED';
        feedback: boolean;
        report: boolean;
        checkedAt: string;
      };
    }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getStatus(organizationId: string) {
    const [models, studentAiEnabled] = await Promise.all([
      this.getModels(organizationId),
      this.isStudentAiEnabled(organizationId),
    ]);
    const mockMode = this.isMockMode();
    const lunaConfigured = Boolean(
      this.config.get<string>('AI_GENERATION_BASE_URL') &&
      this.config.get<string>('AI_GENERATION_API_KEY'),
    );
    const geminiConfigured = Boolean(this.config.get<string>('GEMINI_API_KEY'));
    const service = (
      id: string,
      provider: string,
      purpose: string,
      model: string,
      configured: boolean,
    ) => ({
      id,
      provider,
      purpose,
      model,
      configured,
      active: !mockMode && configured,
      mode: mockMode ? 'MOCK' : configured ? 'LIVE' : 'NOT_CONFIGURED',
    });

    return {
      mockMode,
      studentAiEnabled,
      services: [
        service(
          'generation',
          'GPT Luna',
          'สร้างข้อสอบตามตัวชี้วัด',
          models.generation,
          lunaConfigured,
        ),
        service(
          'reasoning',
          'Gemini Flash',
          'ตรวจคำตอบและให้เหตุผล',
          models.reasoning,
          geminiConfigured,
        ),
        service(
          'report',
          'Flash-Lite',
          'สร้างรายงานผลการเรียนรู้',
          models.report,
          geminiConfigured,
        ),
      ],
    };
  }

  async getStudentStatus(organizationId: string) {
    const cached = this.studentStatusCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const checkedAt = new Date().toISOString();
    if (!(await this.isStudentAiEnabled(organizationId))) {
      return this.cacheStudentStatus(organizationId, {
        status: 'DISABLED' as const,
        feedback: false,
        report: false,
        checkedAt,
      });
    }
    if (this.isMockMode()) {
      return this.cacheStudentStatus(organizationId, {
        status: 'MOCK' as const,
        feedback: false,
        report: false,
        checkedAt,
      });
    }

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return this.cacheStudentStatus(organizationId, {
        status: 'UNAVAILABLE' as const,
        feedback: false,
        report: false,
        checkedAt,
      });
    }

    const models = await this.getModels(organizationId);
    const availability = new Map<string, Promise<boolean>>();
    const check = (model: string) => {
      const existing = availability.get(model);
      if (existing) return existing;
      const pending = this.isGeminiModelAvailable(model, apiKey);
      availability.set(model, pending);
      return pending;
    };
    const [feedback, report] = await Promise.all([
      check(models.reasoning),
      check(models.report),
    ]);
    const status =
      feedback && report
        ? ('AVAILABLE' as const)
        : feedback || report
          ? ('DEGRADED' as const)
          : ('UNAVAILABLE' as const);
    return this.cacheStudentStatus(organizationId, {
      status,
      feedback,
      report,
      checkedAt,
    });
  }

  async isStudentAiEnabled(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { studentAiEnabled: true },
    });
    return organization.studentAiEnabled;
  }

  async setStudentAiEnabled(organizationId: string, enabled: boolean) {
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { studentAiEnabled: enabled },
      select: { studentAiEnabled: true },
    });
    this.studentStatusCache.delete(organizationId);
    return organization;
  }

  generateQuestions(
    context: AiContext,
    input: {
      subject: string;
      indicator?: string;
      instruction?: string;
      count: number;
      types: QuestionType[];
      difficulty: Difficulty;
      language: string;
    },
  ): Promise<GeneratedQuestion[]> {
    const prompt = `คุณเป็นผู้เชี่ยวชาญด้านการวัดผลการศึกษา สร้างข้อสอบภาษา ${input.language}
วิชา: ${input.subject}
ตัวชี้วัด: ${input.indicator ?? '-'}
คำสั่งเพิ่มเติม: ${input.instruction ?? '-'}
จำนวน: ${input.count}
ประเภทที่อนุญาต: ${input.types.join(', ')}
ระดับความยาก: ${input.difficulty}
ตอบเป็น JSON object รูป {"questions": [...]} เท่านั้น แต่ละข้อมี type, difficulty, prompt, options (ถ้ามี โดยใช้ id/text), answerKey, explanation, maxScore, tags
คำถามต้องชัดเจน มีคำตอบแน่นอน ไม่ลำเอียง และตรงตัวชี้วัด`;
    return this.runGeneration(
      context,
      AiTask.GENERATE_QUESTIONS,
      input,
      prompt,
    );
  }

  async generateRemedialQuestion(
    context: AiContext,
    input: {
      originalPrompt: string;
      originalAnswer: unknown;
      studentResponse: unknown;
      feedback?: string;
      type: QuestionType;
      difficulty: Difficulty;
    },
  ): Promise<GeneratedQuestion> {
    const prompt = `สร้างโจทย์ซ่อมเสริมใหม่ 1 ข้อที่วัดทักษะเดียวกับข้อเดิม แต่ห้ามคัดลอกข้อความเดิม
ข้อเดิม: ${input.originalPrompt}
เฉลยเดิม: ${JSON.stringify(input.originalAnswer)}
คำตอบนักเรียน: ${JSON.stringify(input.studentResponse)}
ข้อเสนอแนะเดิม: ${input.feedback ?? '-'}
ประเภท: ${input.type}, ความยาก: ${input.difficulty}
ตอบเป็น JSON object เท่านั้น มี type, difficulty, prompt, options, answerKey, explanation, maxScore, tags`;
    const result = await this.runGeneration(
      context,
      AiTask.GENERATE_REMEDIAL,
      input,
      prompt,
    );
    return result[0] ?? (result as unknown as GeneratedQuestion);
  }

  async gradeAnswer(
    context: AiContext,
    input: {
      prompt: string;
      answerKey: unknown;
      response: unknown;
      maxScore: number;
      rubric?: unknown;
    },
  ): Promise<GradeResult> {
    const prompt = `ตรวจคำตอบนักเรียนอย่างยุติธรรมตามเกณฑ์ ให้เหตุผลที่ช่วยให้เรียนรู้
โจทย์: ${input.prompt}
แนวคำตอบ/เฉลย: ${JSON.stringify(input.answerKey)}
คำตอบนักเรียน: ${JSON.stringify(input.response)}
คะแนนเต็ม: ${input.maxScore}
Rubric: ${JSON.stringify(input.rubric ?? null)}
ตอบ JSON เท่านั้น: {"score": number, "isCorrect": boolean, "feedback": string, "confidence": number}
score ต้องอยู่ระหว่าง 0 ถึงคะแนนเต็ม และ confidence อยู่ระหว่าง 0 ถึง 1`;
    const models = await this.getModels(context.organizationId);
    return this.runGemini<GradeResult>(
      context,
      AiTask.GRADE_ANSWER,
      input,
      prompt,
      models.reasoning,
    );
  }

  async gradeCode(
    context: AiContext,
    input: {
      assignment: string;
      language: string;
      sourceCode: string;
      maxScore: number;
    },
    selectedModel?: string | null,
  ): Promise<GradeResult> {
    const prompt = `คุณเป็นผู้ตรวจงานเขียนโปรแกรม ตรวจ source code ตามโจทย์อย่างเคร่งครัดและยุติธรรม
โจทย์และเกณฑ์: ${input.assignment}
ภาษา: ${input.language}
Source code:
\`\`\`${input.language.toLowerCase()}
${input.sourceCode}
\`\`\`
คะแนนเต็ม: ${input.maxScore}
ตรวจความถูกต้องของแนวคิด การทำงานตามโจทย์ คุณภาพโค้ด และกรณีขอบเขต โดยห้ามอ้างว่าได้รันโค้ดจริง
ให้คำแนะนำภาษาไทยที่ชัดเจนและนำไปแก้ไขได้ทันที
ตอบ JSON เท่านั้น: {"score": number, "isCorrect": boolean, "feedback": string, "confidence": number}
score ต้องอยู่ระหว่าง 0 ถึงคะแนนเต็ม และ confidence อยู่ระหว่าง 0 ถึง 1`;
    const models = await this.getModels(context.organizationId);
    return this.runGemini<GradeResult>(
      context,
      AiTask.GRADE_CODE,
      input,
      prompt,
      selectedModel || models.reasoning,
    );
  }

  async generateReport(
    context: AiContext,
    input: Record<string, unknown>,
  ): Promise<LearningReport> {
    const prompt = `วิเคราะห์ผลสอบต่อไปนี้และสร้างรายงานสั้น กระชับ นำไปใช้สอนได้จริง:
${JSON.stringify(input)}
ตอบ JSON เท่านั้น: {"summary": string, "strengths": string[], "weaknesses": string[], "recommendations": string[], "group": "STRONG"|"AVERAGE"|"NEEDS_SUPPORT"}`;
    const models = await this.getModels(context.organizationId);
    return this.runGemini<LearningReport>(
      context,
      AiTask.GENERATE_REPORT,
      input,
      prompt,
      models.report,
    );
  }

  private async runGeneration(
    context: AiContext,
    task: AiTask,
    input: object,
    prompt: string,
  ): Promise<GeneratedQuestion[]> {
    await this.assertWithinMonthlyTokenBudget(context.organizationId);
    const model = (await this.getModels(context.organizationId)).generation;
    if (this.isMockMode()) {
      const typedInput = input as {
        count?: number;
        types?: QuestionType[];
        type?: QuestionType;
        difficulty?: Difficulty;
      };
      const types = typedInput.types ?? [
        typedInput.type ?? QuestionType.SHORT_ANSWER,
      ];
      const output = Array.from(
        { length: typedInput.count ?? 1 },
        (_, index) => {
          const type = types[index % types.length];
          const isChoice =
            type === QuestionType.MULTIPLE_CHOICE ||
            type === QuestionType.TRUE_FALSE;
          return {
            type,
            difficulty: typedInput.difficulty ?? Difficulty.MEDIUM,
            prompt: `[Mock AI] คำถามตัวอย่างข้อ ${index + 1}`,
            options: isChoice
              ? [
                  { id: 'A', text: 'คำตอบที่ถูก' },
                  { id: 'B', text: 'ตัวลวง' },
                ]
              : undefined,
            answerKey: isChoice
              ? { correctOptionId: 'A' }
              : { acceptedAnswers: ['คำตอบตัวอย่าง'] },
            explanation: 'คำอธิบายตัวอย่างจากโหมดจำลอง',
            maxScore: 1,
            tags: ['mock'],
          };
        },
      );
      await this.logMock(context, task, model, input, output);
      return output;
    }

    const baseUrl = this.config.get<string>('AI_GENERATION_BASE_URL');
    const apiKey = this.config.get<string>('AI_GENERATION_API_KEY');
    if (!baseUrl || !apiKey)
      throw new ServiceUnavailableException(
        'Question generation AI is not configured',
      );

    return this.withLog(context, task, 'gpt-luna', model, input, async () => {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            ...(!/^gpt-5(?:\.|-|$)/i.test(model) ? { temperature: 0.4 } : {}),
            messages: [
              { role: 'system', content: 'Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
          }),
        },
      );
      if (!response.ok)
        await this.throwUpstreamError(response, 'Generation AI');
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const parsed = this.parseJson<
        | GeneratedQuestion
        | GeneratedQuestion[]
        | { questions: GeneratedQuestion[] }
      >(body.choices?.[0]?.message?.content ?? '');
      const output = Array.isArray(parsed)
        ? parsed
        : 'questions' in parsed
          ? parsed.questions
          : [parsed];
      const inputTokens = body.usage?.prompt_tokens ?? 0;
      const outputTokens = body.usage?.completion_tokens ?? 0;
      return {
        output,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: body.usage?.total_tokens ?? inputTokens + outputTokens,
        },
      };
    });
  }

  private async runGemini<T>(
    context: AiContext,
    task: AiTask,
    input: object,
    prompt: string,
    model: string,
  ): Promise<T> {
    await this.assertWithinMonthlyTokenBudget(context.organizationId);
    if (this.isMockMode()) {
      const output = this.mockGemini(task, input) as T;
      await this.logMock(context, task, model, input, output);
      return output;
    }
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException('Gemini AI is not configured');

    return this.withLog(context, task, 'google', model, input, async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });
      if (!response.ok) await this.throwUpstreamError(response, 'Gemini');
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const output = this.parseJson<T>(
        body.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('') ?? '',
      );
      const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
      return {
        output,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens:
            body.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        },
      };
    });
  }

  private async getModels(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        aiGenerationModel: true,
        aiReasoningModel: true,
        aiReportModel: true,
      },
    });
    return {
      generation:
        organization.aiGenerationModel ||
        this.config.get<string>('AI_GENERATION_MODEL', 'gpt-5.6-luna'),
      reasoning:
        organization.aiReasoningModel ||
        this.config.get<string>('AI_REASONING_MODEL', 'gemini-3.5-flash'),
      report:
        organization.aiReportModel ||
        this.config.get<string>('AI_REPORT_MODEL', 'gemini-3.1-flash-lite'),
    };
  }

  private async assertWithinMonthlyTokenBudget(organizationId: string) {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const [organization, requests] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { aiMonthlyTokenBudget: true },
      }),
      this.prisma.aiRequest.findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: { tokenUsage: true },
      }),
    ]);
    const usedTokens = requests.reduce((total, request) => {
      const value = request.tokenUsage;
      const usage =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, Prisma.JsonValue>)
          : {};
      const inputTokens = Number(usage.inputTokens ?? 0) || 0;
      const outputTokens = Number(usage.outputTokens ?? 0) || 0;
      return (
        total + (Number(usage.totalTokens ?? 0) || inputTokens + outputTokens)
      );
    }, 0);

    if (organization.aiMonthlyTokenBudget <= usedTokens) {
      throw new ForbiddenException(
        'โควตา Token สำหรับ AI ขององค์กรหมดแล้ว กรุณาติดต่อผู้ดูแลระบบ',
      );
    }
  }

  private async isGeminiModelAvailable(model: string, apiKey: string) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private cacheStudentStatus(
    organizationId: string,
    value: {
      status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'MOCK' | 'DISABLED';
      feedback: boolean;
      report: boolean;
      checkedAt: string;
    },
  ) {
    this.studentStatusCache.set(organizationId, {
      expiresAt: Date.now() + 60_000,
      value,
    });
    return value;
  }

  private async withLog<T>(
    context: AiContext,
    task: AiTask,
    provider: string,
    model: string,
    input: object,
    operation: () => Promise<AiOperationResult<T>>,
  ): Promise<T> {
    const startedAt = Date.now();
    const log = await this.prisma.aiRequest.create({
      data: {
        organizationId: context.organizationId,
        requestedById: context.requestedById,
        task,
        provider,
        model,
        promptVersion: 'v1',
        input,
      },
    });
    try {
      const result = await operation();
      await this.prisma.aiRequest.update({
        where: { id: log.id },
        data: {
          status: AiStatus.SUCCESS,
          output: result.output as Prisma.InputJsonValue,
          tokenUsage: result.tokenUsage as unknown as Prisma.InputJsonValue,
          latencyMs: Date.now() - startedAt,
          completedAt: new Date(),
        },
      });
      return result.output;
    } catch (error) {
      await this.prisma.aiRequest.update({
        where: { id: log.id },
        data: {
          status: AiStatus.FAILED,
          latencyMs: Date.now() - startedAt,
          errorMessage:
            error instanceof Error ? error.message : 'Unknown AI error',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private logMock(
    context: AiContext,
    task: AiTask,
    model: string,
    input: object,
    output: unknown,
  ) {
    return this.prisma.aiRequest.create({
      data: {
        organizationId: context.organizationId,
        requestedById: context.requestedById,
        task,
        provider: 'mock',
        model,
        promptVersion: 'v1',
        input,
        output: output as Prisma.InputJsonValue,
        status: AiStatus.SUCCESS,
        latencyMs: 0,
        completedAt: new Date(),
      },
    });
  }

  private parseJson<T>(text: string): T {
    try {
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      return JSON.parse(cleaned) as T;
    } catch {
      throw new BadGatewayException('AI returned invalid JSON');
    }
  }

  private async throwUpstreamError(
    response: Response,
    provider: string,
  ): Promise<never> {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsed.error?.message ?? parsed.message ?? raw;
    } catch {
      // Keep the provider's plain-text error response.
    }
    const safeDetail = detail.trim().slice(0, 500);
    throw new BadGatewayException(
      safeDetail
        ? `${provider}: ${safeDetail}`
        : `${provider} returned ${response.status}`,
    );
  }

  private isMockMode() {
    return (
      this.config.get<string>('AI_MOCK_MODE', 'false').toLowerCase() === 'true'
    );
  }

  private mockGemini(
    task: AiTask,
    input: object,
  ): GradeResult | LearningReport {
    if (task === AiTask.GENERATE_REPORT) {
      return {
        summary: 'รายงานตัวอย่างจากโหมดจำลอง',
        strengths: [],
        weaknesses: [],
        recommendations: ['เชื่อมต่อ Gemini API เพื่อรับผลวิเคราะห์จริง'],
        group: 'AVERAGE',
      };
    }
    const maxScore = Number((input as { maxScore?: number }).maxScore ?? 1);
    return {
      score: 0,
      isCorrect: false,
      feedback: 'ผลตรวจตัวอย่างจากโหมดจำลอง กรุณาเชื่อมต่อ Gemini API',
      confidence: Math.min(0.5, maxScore),
    };
  }
}
