import { Injectable } from '@nestjs/common';
import { CampaignStatus, EventType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Role-aware dashboard aggregates.
   *  - SUPER_ADMIN: whole tenant
   *  - SUB_ADMIN:   only assigned users
   *  - USER:        only their own data
   */
  async summary(user: AuthUser) {
    const scope = await this.scopeWhere(user);

    const [campaigns, users, pendingApprovals, eventGroups] = await Promise.all([
      this.prisma.campaign.groupBy({
        by: ['status'],
        where: scope.campaign,
        _count: { _all: true },
      }),
      user.role === Role.USER
        ? Promise.resolve(0)
        : this.prisma.user.count({ where: scope.user }),
      user.role === Role.USER
        ? Promise.resolve(0)
        : this.prisma.approval.count({
            where: { tenantId: user.tenantId, status: 'PENDING' },
          }),
      this.prisma.emailEvent.groupBy({
        by: ['eventType'],
        where: { campaign: scope.campaign },
        _count: { _all: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const c of campaigns) byStatus[c.status] = c._count._all;

    const ev: Record<string, number> = {};
    for (const g of eventGroups) ev[g.eventType] = g._count._all;
    const sent = ev[EventType.SENT] ?? 0;
    const rate = (n: number) =>
      sent ? Math.round((n / sent) * 1000) / 10 : 0;

    return {
      totalUsers: users,
      totalCampaigns: Object.values(byStatus).reduce((a, b) => a + b, 0),
      campaignsByStatus: byStatus,
      activeCampaigns:
        (byStatus[CampaignStatus.RUNNING] ?? 0) +
        (byStatus[CampaignStatus.SCHEDULED] ?? 0),
      pendingApprovals,
      sent,
      delivered: ev[EventType.DELIVERED] ?? 0,
      opens: ev[EventType.OPEN] ?? 0,
      clicks: ev[EventType.CLICK] ?? 0,
      replies: ev[EventType.REPLY] ?? 0,
      bounces: ev[EventType.BOUNCE] ?? 0,
      failed: ev[EventType.BOUNCE] ?? 0,
      openRate: rate(ev[EventType.OPEN] ?? 0),
      clickRate: rate(ev[EventType.CLICK] ?? 0),
      replyRate: rate(ev[EventType.REPLY] ?? 0),
      bounceRate: rate(ev[EventType.BOUNCE] ?? 0),
    };
  }

  activityLogs(user: AuthUser, take = 100) {
    return this.prisma.activityLog.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { actor: { select: { name: true, email: true } } },
    });
  }

  /** Builds the campaign/user where-filters for the caller's scope. */
  private async scopeWhere(user: AuthUser) {
    if (user.role === Role.USER) {
      return {
        campaign: { tenantId: user.tenantId, userId: user.userId },
        user: { tenantId: user.tenantId, id: user.userId },
      };
    }
    if (user.role === Role.SUB_ADMIN) {
      const ids = await this.assignedUserIds(user.userId);
      return {
        campaign: { tenantId: user.tenantId, userId: { in: ids } },
        user: { tenantId: user.tenantId, id: { in: ids } },
      };
    }
    return {
      campaign: { tenantId: user.tenantId },
      user: { tenantId: user.tenantId },
    };
  }

  private async assignedUserIds(subAdminId: string): Promise<string[]> {
    const rows = await this.prisma.subAdminAssignment.findMany({
      where: { subAdminId, assignedUserId: { not: null } },
      select: { assignedUserId: true },
    });
    return rows.map((r) => r.assignedUserId!).filter(Boolean);
  }
}
