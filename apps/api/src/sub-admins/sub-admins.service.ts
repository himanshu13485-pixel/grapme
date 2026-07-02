import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

interface CreateSubAdminDto {
  name: string;
  email: string;
  password: string;
  fullAccess?: boolean;
  accessModules?: string[];
}
interface UpdateSubAdminDto {
  name?: string;
  password?: string;
  status?: string;
  fullAccess?: boolean;
  accessModules?: string[];
}

@Injectable()
export class SubAdminsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, role: Role.SUB_ADMIN },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        fullAccess: true,
        accessModules: true,
        lastLoginAt: true,
        _count: { select: { assignmentsAsSubAdmin: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Create a sub-admin login (email + password) with access config. */
  async create(actor: AuthUser, dto: CreateSubAdminDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already in use');
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        tenantId: actor.tenantId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: Role.SUB_ADMIN,
        fullAccess: dto.fullAccess ?? false,
        accessModules: dto.fullAccess ? [] : dto.accessModules ?? [],
      },
      select: { id: true, name: true, email: true },
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'CREATE_SUBADMIN',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, fullAccess: dto.fullAccess ?? false },
    });
    return user;
  }

  /** Update a sub-admin's access, name, status, or password. */
  async update(actor: AuthUser, id: string, dto: UpdateSubAdminDto) {
    await this.assertSubAdmin(actor.tenantId, id);
    const data: Record<string, unknown> = {
      name: dto.name,
      status: dto.status,
    };
    if (dto.fullAccess !== undefined) data.fullAccess = dto.fullAccess;
    if (dto.accessModules !== undefined)
      data.accessModules = dto.fullAccess ? [] : dto.accessModules;
    if (dto.password)
      data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        fullAccess: true,
        accessModules: true,
        status: true,
      },
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'UPDATE_SUBADMIN',
      entityType: 'User',
      entityId: id,
      after: { fullAccess: user.fullAccess, passwordChanged: !!dto.password },
    });
    return user;
  }

  /** Delete a sub-admin login (assignments cascade). */
  async remove(actor: AuthUser, id: string) {
    const sa = await this.assertSubAdmin(actor.tenantId, id);
    await this.prisma.user.delete({ where: { id } });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'DELETE_SUBADMIN',
      entityType: 'User',
      entityId: id,
      after: { email: sa.email },
    });
    return { success: true };
  }

  async assignments(tenantId: string, subAdminId: string) {
    await this.assertSubAdmin(tenantId, subAdminId);
    return this.prisma.subAdminAssignment.findMany({
      where: { subAdminId },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
        campaign: { select: { id: true, name: true } },
      },
    });
  }

  async assign(
    actor: AuthUser,
    subAdminId: string,
    body: { assignedUserId?: string; assignedCampaignId?: string },
  ) {
    await this.assertSubAdmin(actor.tenantId, subAdminId);
    const assignment = await this.prisma.subAdminAssignment.create({
      data: {
        subAdminId,
        assignedUserId: body.assignedUserId,
        assignedCampaignId: body.assignedCampaignId,
      },
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'ASSIGN_SUBADMIN',
      entityType: 'SubAdminAssignment',
      entityId: assignment.id,
      after: body,
    });
    return assignment;
  }

  async unassign(actor: AuthUser, assignmentId: string) {
    await this.prisma.subAdminAssignment.delete({ where: { id: assignmentId } });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'UNASSIGN_SUBADMIN',
      entityType: 'SubAdminAssignment',
      entityId: assignmentId,
    });
    return { success: true };
  }

  private async assertSubAdmin(tenantId: string, subAdminId: string) {
    const sa = await this.prisma.user.findFirst({
      where: { id: subAdminId, tenantId, role: Role.SUB_ADMIN },
    });
    if (!sa) throw new NotFoundException('Sub-admin not found');
    return sa;
  }
}
