import { Injectable } from '@nestjs/common';
import {
  CampaignStatus,
  EnrollmentStatus,
  EventType,
  MessageStatus,
  Role,
} from '@prisma/client';
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

    // Fold in the GRAPOUT cohort engine: its sends/opens/replies carry a
    // cohortId (no campaignId), so without this the dashboard would ignore all
    // cohort outreach. Admin-scoped (cohorts are tenant-level, not user-owned).
    let cohortCount = 0;
    let activeCohorts = 0;
    if (user.role !== Role.USER) {
      const [cohortEvents, cohortStatuses] = await Promise.all([
        this.prisma.emailEvent.groupBy({
          by: ['eventType'],
          where: {
            message: { tenantId: user.tenantId, cohortId: { not: null } },
          },
          _count: { _all: true },
        }),
        this.prisma.cohort.groupBy({
          by: ['status'],
          where: { tenantId: user.tenantId },
          _count: { _all: true },
        }),
      ]);
      for (const g of cohortEvents)
        ev[g.eventType] = (ev[g.eventType] ?? 0) + g._count._all;
      for (const c of cohortStatuses) {
        cohortCount += c._count._all;
        if (c.status === 'RUNNING') activeCohorts += c._count._all;
      }
    }

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
      totalCohorts: cohortCount,
      activeCohorts,
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

  /** Recent cohorts across the tenant with live send/reply stats (dashboard). */
  async recentCohorts(user: AuthUser, take = 8) {
    if (user.role === Role.USER) return [];
    const cohorts = await this.prisma.cohort.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { client: { select: { id: true, name: true } } },
    });
    const ids = cohorts.map((c) => c.id);
    const [enrolls, sentMsgs, replied] = await Promise.all([
      this.prisma.enrollment.groupBy({
        by: ['cohortId'],
        where: { cohortId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.emailMessage.groupBy({
        by: ['cohortId'],
        where: {
          cohortId: { in: ids },
          status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
        },
        _count: { _all: true },
      }),
      this.prisma.enrollment.groupBy({
        by: ['cohortId'],
        where: { cohortId: { in: ids }, status: EnrollmentStatus.REPLIED },
        _count: { _all: true },
      }),
    ]);
    const total = new Map(enrolls.map((e) => [e.cohortId, e._count._all]));
    const sent = new Map(sentMsgs.map((m) => [m.cohortId, m._count._all]));
    const reps = new Map(replied.map((r) => [r.cohortId, r._count._all]));
    return cohorts.map((c) => ({
      id: c.id,
      label: c.label,
      monthIndex: c.monthIndex,
      status: c.status,
      startDate: c.startDate,
      clientId: c.clientId,
      clientName: c.client?.name ?? null,
      contacts: total.get(c.id) ?? 0,
      sent: sent.get(c.id) ?? 0,
      replies: reps.get(c.id) ?? 0,
    }));
  }

  activityLogs(user: AuthUser, take = 250) {
    return this.prisma.activityLog.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { actor: { select: { name: true, email: true, role: true } } },
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
