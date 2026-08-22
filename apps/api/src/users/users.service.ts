import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateProfileDto } from './dto/users.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  timezone: true,
  avatarUrl: true,
  contactMobile: true,
  notifyEmail: true,
  notifyWhatsapp: true,
  notifyTelegram: true,
  whatsappVerifiedAt: true,
  telegramVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Tenant-scoped list. A SUB_ADMIN sees only the users assigned to them;
   * a SUPER_ADMIN sees the whole tenant.
   */
  async list(user: AuthUser) {
    let idFilter: { id?: { in: string[] } } = {};
    if (user.role === Role.SUB_ADMIN) {
      const rows = await this.prisma.subAdminAssignment.findMany({
        where: { subAdminId: user.userId, assignedUserId: { not: null } },
        select: { assignedUserId: true },
      });
      idFilter = { id: { in: rows.map((r) => r.assignedUserId!) } };
    }
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId, ...idFilter },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    return this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role ?? Role.USER,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async getOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: PUBLIC_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Changing the number invalidates every proof attached to the old one.
    // Without this, verifying number A and then switching to number B leaves
    // both channels "verified" and starts alerting an unconfirmed number —
    // the exact thing the OTP exists to prevent.
    const data: Record<string, unknown> = { ...dto };

    if (dto.contactMobile !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { contactMobile: true },
      });
      const next = (dto.contactMobile ?? '').trim() || null;

      if ((current?.contactMobile ?? null) !== next) {
        data.whatsappVerifiedAt = null;
        data.telegramVerifiedAt = null;
        data.notifyWhatsapp = false;
        data.notifyTelegram = false;
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_FIELDS,
    });
  }

  async suspend(tenantId: string, id: string) {
    await this.getOne(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
      select: PUBLIC_FIELDS,
    });
  }
}
