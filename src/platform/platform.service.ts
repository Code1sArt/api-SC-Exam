import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiStatus, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrganizationDto,
  UpdateAiModelsDto,
  UpdateOrganizationDto,
} from './dto/platform.dto';

@Injectable()
export class PlatformService {
  private catalogCache?: {
    expiresAt: number;
    models: Array<{
      id: string;
      provider: 'OPENAI' | 'GOOGLE';
      name: string;
      inputPricePerMillion: number;
      outputPricePerMillion: number;
      contextLength: number | null;
    }>;
  };
  private exchangeRateCache?: {
    expiresAt: number;
    date: string;
    rate: number;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getAiModelCatalog() {
    if (this.catalogCache && this.catalogCache.expiresAt > Date.now()) {
      return { models: this.catalogCache.models, cached: true };
    }

    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/models?output_modalities=text',
        {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        throw new Error(`OpenRouter returned ${response.status}`);
      const body = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          context_length?: number;
          expiration_date?: string | null;
          architecture?: { output_modalities?: string[] };
          pricing?: { prompt?: string; completion?: string };
        }>;
      };
      const models = (body.data ?? [])
        .filter((model) => {
          const isGpt =
            model.id.startsWith('openai/') && /(^|[/-])gpt/i.test(model.id);
          const isGemini =
            model.id.startsWith('google/') && /gemini/i.test(model.id);
          const producesText =
            model.architecture?.output_modalities?.includes('text') ?? true;
          return (
            (isGpt || isGemini) &&
            producesText &&
            !/image/i.test(model.id) &&
            !model.expiration_date
          );
        })
        .map((model) => ({
          id: model.id.replace(/^(openai|google)\//, ''),
          provider: model.id.startsWith('openai/')
            ? ('OPENAI' as const)
            : ('GOOGLE' as const),
          name: model.name.replace(/^(OpenAI|Google):\s*/i, ''),
          inputPricePerMillion: Number(model.pricing?.prompt ?? 0) * 1_000_000,
          outputPricePerMillion:
            Number(model.pricing?.completion ?? 0) * 1_000_000,
          contextLength: model.context_length ?? null,
        }))
        .filter(
          (model, index, rows) =>
            rows.findIndex(
              (candidate) =>
                candidate.id === model.id &&
                candidate.provider === model.provider,
            ) === index,
        )
        .sort((left, right) =>
          left.provider === right.provider
            ? left.name.localeCompare(right.name)
            : left.provider.localeCompare(right.provider),
        );

      if (!models.length) throw new Error('No GPT or Gemini models found');
      this.catalogCache = {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        models,
      };
      return { models, cached: false };
    } catch (error) {
      if (this.catalogCache) {
        return { models: this.catalogCache.models, cached: true };
      }
      throw new BadGatewayException(
        error instanceof Error
          ? `Unable to load AI model catalog: ${error.message}`
          : 'Unable to load AI model catalog',
      );
    }
  }

  private async getUsdThbRate() {
    if (
      this.exchangeRateCache &&
      this.exchangeRateCache.expiresAt > Date.now()
    ) {
      return { ...this.exchangeRateCache, cached: true };
    }
    try {
      const response = await fetch(
        'https://api.frankfurter.dev/v2/rate/USD/THB',
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok)
        throw new Error(`Exchange-rate provider returned ${response.status}`);
      const body = (await response.json()) as {
        date?: string;
        base?: string;
        quote?: string;
        rate?: number;
      };
      if (
        body.base !== 'USD' ||
        body.quote !== 'THB' ||
        !body.date ||
        !Number.isFinite(body.rate) ||
        Number(body.rate) <= 0
      ) {
        throw new Error('Exchange-rate provider returned invalid data');
      }
      this.exchangeRateCache = {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        date: body.date,
        rate: Number(body.rate),
      };
      return { ...this.exchangeRateCache, cached: false };
    } catch {
      return this.exchangeRateCache
        ? { ...this.exchangeRateCache, cached: true }
        : null;
    }
  }

  listOrganizations() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        aiGenerationModel: true,
        aiReasoningModel: true,
        aiReportModel: true,
        studentAiEnabled: true,
        aiMonthlyTokenBudget: true,
        createdAt: true,
        updatedAt: true,
        users: {
          where: { role: UserRole.ADMIN },
          select: { id: true, email: true, firstName: true, lastName: true },
          take: 1,
        },
        _count: { select: { users: true, classrooms: true, exams: true } },
      },
    });
  }

  async createOrganization(dto: CreateOrganizationDto) {
    const code = dto.code.toUpperCase();
    const email = dto.adminEmail.toLowerCase();
    const duplicate = await this.prisma.organization.findUnique({
      where: { code },
    });
    if (duplicate)
      throw new ConflictException('Organization code is already in use');
    const duplicateEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (duplicateEmail)
      throw new ConflictException('Admin email is already in use');
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
    return this.prisma.organization.create({
      data: {
        name: dto.name,
        code,
        users: {
          create: {
            email,
            passwordHash,
            firstName: dto.adminFirstName,
            lastName: dto.adminLastName,
            role: UserRole.ADMIN,
          },
        },
      },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  updateOrganization(id: string, dto: UpdateOrganizationDto) {
    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code?.toUpperCase(),
        isActive: dto.isActive,
        users:
          dto.isActive === undefined
            ? undefined
            : {
                updateMany: {
                  where: { role: { not: UserRole.SUPER_ADMIN } },
                  data: { isActive: dto.isActive },
                },
              },
      },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  updateAiModels(id: string, dto: UpdateAiModelsDto) {
    return this.prisma.organization.update({
      where: { id },
      data: {
        aiGenerationModel: dto.generationModel,
        aiReasoningModel: dto.reasoningModel,
        aiReportModel: dto.reportModel,
      },
      select: {
        id: true,
        aiGenerationModel: true,
        aiReasoningModel: true,
        aiReportModel: true,
      },
    });
  }

  async getAiUsage() {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const [organizations, requests] = await Promise.all([
      this.prisma.organization.findMany({
        where: { users: { some: { role: { not: UserRole.SUPER_ADMIN } } } },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          aiMonthlyTokenBudget: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.aiRequest.findMany({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
        select: {
          organizationId: true,
          task: true,
          provider: true,
          model: true,
          status: true,
          tokenUsage: true,
        },
      }),
    ]);

    let catalog: Awaited<
      ReturnType<PlatformService['getAiModelCatalog']>
    >['models'] = [];
    try {
      catalog = (await this.getAiModelCatalog()).models;
    } catch {
      // Usage remains available if the external price catalog is temporarily unavailable.
    }
    const prices = new Map(
      catalog.map((model) => [
        model.id,
        {
          input: model.inputPricePerMillion,
          output: model.outputPricePerMillion,
        },
      ]),
    );
    const exchangeRate = await this.getUsdThbRate();
    const usdToThb = exchangeRate?.rate ?? 0;
    const readUsage = (value: Prisma.JsonValue | null) => {
      const usage =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, Prisma.JsonValue>)
          : {};
      const inputTokens = Number(usage.inputTokens ?? 0) || 0;
      const outputTokens = Number(usage.outputTokens ?? 0) || 0;
      const totalTokens =
        Number(usage.totalTokens ?? 0) || inputTokens + outputTokens;
      return { inputTokens, outputTokens, totalTokens };
    };
    const summarize = (rows: typeof requests) => {
      const byModel = new Map<
        string,
        {
          model: string;
          provider: string;
          requests: number;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCostUsd: number;
          estimatedCostThb: number;
          unknownCostRequests: number;
        }
      >();
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let estimatedCostUsd = 0;
      let unknownCostRequests = 0;
      for (const request of rows) {
        const usage = readUsage(request.tokenUsage);
        const price = prices.get(request.model);
        const requestCost = price
          ? (usage.inputTokens * price.input +
              usage.outputTokens * price.output) /
            1_000_000
          : 0;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        totalTokens += usage.totalTokens;
        estimatedCostUsd += requestCost;
        if (!price && usage.totalTokens > 0) unknownCostRequests += 1;
        const model = byModel.get(request.model) ?? {
          model: request.model,
          provider: request.provider,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          estimatedCostThb: 0,
          unknownCostRequests: 0,
        };
        model.requests += 1;
        model.inputTokens += usage.inputTokens;
        model.outputTokens += usage.outputTokens;
        model.totalTokens += usage.totalTokens;
        model.estimatedCostUsd += requestCost;
        model.estimatedCostThb += requestCost * usdToThb;
        if (!price && usage.totalTokens > 0) model.unknownCostRequests += 1;
        byModel.set(request.model, model);
      }
      return {
        requests: rows.length,
        successfulRequests: rows.filter(
          (request) => request.status === AiStatus.SUCCESS,
        ).length,
        failedRequests: rows.filter(
          (request) => request.status === AiStatus.FAILED,
        ).length,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        estimatedCostThb: estimatedCostUsd * usdToThb,
        unknownCostRequests,
        byModel: [...byModel.values()].sort(
          (left, right) => right.totalTokens - left.totalTokens,
        ),
      };
    };
    const organizationUsage = organizations.map((organization) => {
      const usage = summarize(
        requests.filter(
          (request) => request.organizationId === organization.id,
        ),
      );
      return {
        ...organization,
        ...usage,
        remainingTokens: Math.max(
          0,
          organization.aiMonthlyTokenBudget - usage.totalTokens,
        ),
        usagePercent: organization.aiMonthlyTokenBudget
          ? Math.min(
              100,
              (usage.totalTokens / organization.aiMonthlyTokenBudget) * 100,
            )
          : usage.totalTokens > 0
            ? 100
            : 0,
      };
    });
    const totals = summarize(requests);
    const totalBudget = organizations.reduce(
      (sum, organization) => sum + organization.aiMonthlyTokenBudget,
      0,
    );
    return {
      periodStart,
      periodEnd,
      priceCatalogAvailable: prices.size > 0,
      exchangeRateAvailable: Boolean(exchangeRate),
      exchangeRate: exchangeRate
        ? {
            base: 'USD',
            quote: 'THB',
            rate: exchangeRate.rate,
            date: exchangeRate.date,
            source: 'Frankfurter',
            cached: exchangeRate.cached,
          }
        : null,
      totals: {
        ...totals,
        totalBudget,
        remainingTokens: Math.max(0, totalBudget - totals.totalTokens),
      },
      organizations: organizationUsage,
    };
  }

  updateAiBudget(id: string, monthlyTokenBudget: number) {
    return this.prisma.organization.update({
      where: { id },
      data: { aiMonthlyTokenBudget: monthlyTokenBudget },
      select: { id: true, aiMonthlyTokenBudget: true },
    });
  }
}
