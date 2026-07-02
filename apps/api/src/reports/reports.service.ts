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
    // null = all clients (super admin); [] or ids = the sub-admin's clients.
    const ccids = scope.cohortClientIds;
    const seeCohorts = user.role !== Role.USER && (ccids === null || ccids.length > 0);
    if (seeCohorts) {
      const cohortWhere = ccids === null ? {} : { clientId: { in: ccids } };
      // Message cohortId filter for events: restrict to scoped cohorts' ids.
      const scopedCohortIds =
        ccids === null
          ? undefined
          : (
              await this.prisma.cohort.findMany({
                where: { tenantId: user.tenantId, clientId: { in: ccids } },
                select: { id: true },
              })
            ).map((c) => c.id);
      const [cohortEvents, cohortStatuses] = await Promise.all([
        this.prisma.emailEvent.groupBy({
          by: ['eventType'],
          where: {
            message: {
              tenantId: user.tenantId,
              cohortId: scopedCohortIds ? { in: scopedCohortIds } : { not: null },
            },
          },
          _count: { _all: true },
        }),
        this.prisma.cohort.groupBy({
          by: ['status'],
          where: { tenantId: user.tenantId, ...cohortWhere },
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
    const bounces = ev[EventType.BOUNCE] ?? 0;
    const rate = (n: number) =>
      sent ? Math.round((n / sent) * 1000) / 10 : 0;
    const attempts = sent + bounces;
    const deliveryRate = attempts ? Math.round((sent / attempts) * 1000) / 10 : 0;

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
      delivered: sent,
      deliveryRate,
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
    let clientFilter = {};
    if (user.role === Role.SUB_ADMIN) {
      const sa = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { fullAccess: true },
      });
      if (!sa?.fullAccess) {
        const ids = await this.assignedClientIds(user.userId);
        clientFilter = { clientId: { in: ids } };
      }
    }
    const cohorts = await this.prisma.cohort.findMany({
      where: { tenantId: user.tenantId, ...clientFilter },
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

  async activityLogs(user: AuthUser, take = 250) {
    const logs = await this.prisma.activityLog.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { actor: { select: { name: true, email: true, role: true } } },
    });
    const clientNames = await this.resolveLogClients(logs);
    return logs.map((l) => ({ ...l, clientName: clientNames.get(l.id) ?? null }));
  }

  /** Best-effort owning-client (company) name per activity-log entry. */
  private async resolveLogClients(
    logs: { id: string; entityType: string; entityId: string | null; after: unknown }[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const idsOf = (types: string[]) =>
      logs
        .filter((l) => l.entityId && types.includes(l.entityType))
        .map((l) => l.entityId!) as string[];

    const [cohorts, mailboxes, campaigns, templates, contacts, imports, lists] =
      await Promise.all([
        this.prisma.cohort.findMany({ where: { id: { in: idsOf(['Cohort']) } }, select: { id: true, clientId: true } }),
        this.prisma.emailAccount.findMany({ where: { id: { in: idsOf(['EmailAccount', 'SMTP']) } }, select: { id: true, clientId: true } }),
        this.prisma.campaign.findMany({ where: { id: { in: idsOf(['Campaign', 'CAMPAIGN']) } }, select: { id: true, clientId: true } }),
        this.prisma.emailTemplate.findMany({ where: { id: { in: idsOf(['EmailTemplate']) } }, select: { id: true, clientId: true } }),
        this.prisma.contact.findMany({ where: { id: { in: idsOf(['Contact']) } }, select: { id: true, clientId: true } }),
        this.prisma.importJob.findMany({ where: { id: { in: idsOf(['ImportJob', 'IMPORT']) } }, select: { id: true, clientId: true } }),
        this.prisma.contactList.findMany({ where: { id: { in: idsOf(['ContactList']) } }, select: { id: true, clientId: true } }),
      ]);

    const entClient = new Map<string, string | null>();
    for (const rows of [cohorts, mailboxes, campaigns, templates, contacts, imports, lists])
      for (const r of rows) entClient.set(r.id, r.clientId);

    // Resolve all referenced client ids (+ 'Client' entities themselves) to names.
    const clientIds = new Set<string>([...idsOf(['Client'])]);
    entClient.forEach((cid) => cid && clientIds.add(cid));
    const clientRows = await this.prisma.client.findMany({
      where: { id: { in: [...clientIds] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(clientRows.map((c) => [c.id, c.name]));

    for (const l of logs) {
      let name: string | undefined;
      if (l.entityType === 'Client' && l.entityId) {
        name = nameById.get(l.entityId);
      } else if (l.entityId) {
        const cid = entClient.get(l.entityId);
        if (cid) name = nameById.get(cid);
      }
      // Fallback: some logs embed the client name in their payload.
      if (!name) {
        const after = l.after as { client?: string } | null;
        if (after?.client) name = after.client;
      }
      if (name) out.set(l.id, name);
    }
    return out;
  }

  /**
   * Builds the caller's scope. `cohortClientIds` = null means "all clients"
   * (super admin); an array restricts to those clients (sub-admin's assigned
   * clients); USER role sees only their own campaigns and no cohorts.
   */
  private async scopeWhere(user: AuthUser): Promise<{
    campaign: Record<string, unknown>;
    user: Record<string, unknown>;
    cohortClientIds: string[] | null;
  }> {
    if (user.role === Role.USER) {
      return {
        campaign: { tenantId: user.tenantId, userId: user.userId },
        user: { tenantId: user.tenantId, id: user.userId },
        cohortClientIds: [], // users don't own cohorts
      };
    }
    if (user.role === Role.SUB_ADMIN) {
      // A full-access sub-admin sees the whole tenant (same as super admin);
      // otherwise scope to their assigned clients.
      const sa = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { fullAccess: true },
      });
      if (sa?.fullAccess) {
        return {
          campaign: { tenantId: user.tenantId },
          user: { tenantId: user.tenantId },
          cohortClientIds: null,
        };
      }
      const clientIds = await this.assignedClientIds(user.userId);
      return {
        campaign: { tenantId: user.tenantId, clientId: { in: clientIds } },
        user: { tenantId: user.tenantId },
        cohortClientIds: clientIds,
      };
    }
    return {
      campaign: { tenantId: user.tenantId },
      user: { tenantId: user.tenantId },
      cohortClientIds: null,
    };
  }

  private async assignedClientIds(subAdminId: string): Promise<string[]> {
    const rows = await this.prisma.subAdminAssignment.findMany({
      where: { subAdminId, assignedClientId: { not: null } },
      select: { assignedClientId: true },
    });
    return rows.map((r) => r.assignedClientId!).filter(Boolean);
  }
}
