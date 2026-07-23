import { UserRole } from '@prisma/client';

export interface AuthUser {
  sub: string;
  organizationId: string;
  role: UserRole;
  email: string;
}
