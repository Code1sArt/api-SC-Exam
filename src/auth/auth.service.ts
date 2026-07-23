import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapDto } from './dto/bootstrap.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async bootstrap(dto: BootstrapDto) {
    if ((await this.prisma.user.count()) > 0) {
      throw new ConflictException('System has already been initialized');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          code: dto.organizationCode.toUpperCase(),
        },
      });
      return tx.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: UserRole.SUPER_ADMIN,
        },
      });
    });
    return this.createSession(user);
  }

  async login(dto: LoginDto) {
    const identifier = (
      dto.identifier ??
      dto.email ??
      dto.studentCode ??
      ''
    ).trim();
    if (!identifier)
      throw new UnauthorizedException('Invalid login identifier or password');
    const user = identifier.includes('@')
      ? await this.prisma.user.findUnique({
          where: { email: identifier.toLowerCase() },
        })
      : await this.prisma.user.findFirst({
          where: {
            role: UserRole.STUDENT,
            studentProfile: { studentCode: identifier },
          },
        });
    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.createSession(user);
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organization: { select: { id: true, name: true, code: true } },
        studentProfile: { select: { id: true, studentCode: true } },
      },
    });
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    if (!dto.firstName && !dto.lastName && !dto.newPassword) {
      throw new BadRequestException('No profile changes provided');
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (dto.newPassword) {
      if (
        !dto.currentPassword ||
        !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
      ) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash: dto.newPassword
          ? await bcrypt.hash(dto.newPassword, 12)
          : undefined,
      },
    });
    return this.me(user.id);
  }

  private async createSession(user: {
    id: string;
    organizationId: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
  }) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}
