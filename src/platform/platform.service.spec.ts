import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformService } from './platform.service';

describe('PlatformService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('includes every organization in AI usage, even without non-super-admin users', async () => {
    const organizations = [
      {
        id: 'org-super-admin-only',
        name: 'Super Admin Organization',
        code: 'SUPER',
        isActive: true,
        aiMonthlyTokenBudget: 1_000_000,
      },
      {
        id: 'org-empty',
        name: 'Empty Organization',
        code: 'EMPTY',
        isActive: true,
        aiMonthlyTokenBudget: 500_000,
      },
    ];
    const organizationFindMany = jest.fn().mockResolvedValue(organizations);
    const prisma = {
      organization: { findMany: organizationFindMany },
      aiRequest: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));

    const result = await new PlatformService(prisma, config).getAiUsage();

    expect(organizationFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        aiMonthlyTokenBudget: true,
      },
      orderBy: { name: 'asc' },
    });
    expect(result.organizations).toHaveLength(2);
    expect(
      result.organizations.map((organization) => organization.code),
    ).toEqual(['SUPER', 'EMPTY']);
  });
});
