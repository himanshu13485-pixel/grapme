import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

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
        _count: { select: { assignmentsAsSubAdmin: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
