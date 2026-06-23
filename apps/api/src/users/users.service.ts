import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateProfileDto } from './dto/users.dto';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  timezone: true,
  avatarUrl: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Tenant-scoped list — never leaks across tenants. */
  list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
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

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
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
