import { Injectable } from '@nestjs/common';
import {
  CampaignStatus,
  EnrollmentStatus,
  EventType,
  LinkedInAccountStatus,
  MessageDirection,
  MessageStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { cohortRef } from '../common/cohort-ref.util';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ── Email activity log (admin, cross-client) ────────────────────────
  /**
   * Recipient-level email log across clients: each OUTBOUND message with its derived
   * open / click / reply / bounce / forward status, the client + source (campaign or
   * cohort), and the contact. Filters by client search, an event, a campaign/cohort,
   * and a sent-date range (defaults to the last 7 days). Read-only. Paginated.
   */
  async globalEmailLog(tenantId: string, opts: {
    clientSearch?: string; event?: string; campaignId?: string; cohortId?: string;
    from?: string; to?: string; page?: number; pageSize?: number;
    // When set, hard-restrict the result to these client ids (client-portal scoping).
    restrictClientIds?: string[];
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

    // A restricted (client-portal) caller only ever sees their own workspaces. An empty
    // allow-list means "no workspaces" → nothing to show.
    if (opts.restrictClientIds && opts.restrictClientIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    let clientIds: string[] | undefined = opts.restrictClientIds;
    const q = opts.clientSearch?.trim();
    if (q) {
      const ci = { contains: q, mode: 'insensitive' as const };
      const clients = await this.prisma.client.findMany({
        where: { tenantId, OR: [{ name: ci }, { productCategory: ci }, { invoiceNo: ci }] },
        select: { id: true },
      });
      let matched = clients.map((c) => c.id);
      // Intersect the search with the restriction so a client can't reach others' data.
      if (opts.restrictClientIds) matched = matched.filter((id) => opts.restrictClientIds!.includes(id));
      clientIds = matched;
      if (clientIds.length === 0) return { items: [], total: 0, page, pageSize };
    }

    // A message links to a client via campaign.clientId (a relation) OR its cohortId
    // scalar (no `cohort` relation on the message) — resolve those cohorts here.
    let clientCohortIds: string[] = [];
    if (clientIds) {
      const cs = await this.prisma.cohort.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
      clientCohortIds = cs.map((c) => c.id);
    }

    const sentRange = emailDateRange(opts.from, opts.to) ?? defaultRecentRange();
    const eventCond: Prisma.EmailMessageWhereInput =
      opts.event === 'opened' ? { events: { some: { eventType: EventType.OPEN } } }
      : opts.event === 'clicked' ? { events: { some: { eventType: EventType.CLICK } } }
      : opts.event === 'replied' ? { events: { some: { eventType: EventType.REPLY } } }
      : opts.event === 'bounced' ? { OR: [{ status: MessageStatus.BOUNCED }, { events: { some: { eventType: EventType.BOUNCE } } }] }
      : {};
    const clientCond: Prisma.EmailMessageWhereInput = clientIds
      ? { OR: [{ campaign: { clientId: { in: clientIds } } }, { cohortId: { in: clientCohortIds } }] }
      : {};

    const where: Prisma.EmailMessageWhereInput = {
      tenantId,
      direction: MessageDirection.OUTBOUND,
      ...(sentRange ? { sentAt: sentRange } : {}),
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      ...(opts.cohortId ? { cohortId: opts.cohortId } : {}),
      AND: [clientCond, eventCond],
    };

    const total = await this.prisma.emailMessage.count({ where });
    const rows = await this.prisma.emailMessage.findMany({
      where, orderBy: { sentAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, subject: true, status: true, sentAt: true, cohortId: true, error: true,
        contact: { select: { email: true, firstName: true, lastName: true, company: true } },
        campaign: { select: { name: true, clientId: true } },
        events: { select: { eventType: true, occurredAt: true, meta: true } },
      },
    });

    // EmailMessage has a cohortId scalar but no `cohort` relation → look them up.
    const cohortIds = [...new Set(rows.map((r) => r.cohortId).filter(Boolean) as string[])];
    const cohorts = await this.prisma.cohort.findMany({ where: { id: { in: cohortIds } }, select: { id: true, label: true, clientId: true } });
    const cohortMap = new Map(cohorts.map((c) => [c.id, c]));

    const clientIdSet = [...new Set(rows.map((r) => r.campaign?.clientId ?? (r.cohortId ? cohortMap.get(r.cohortId)?.clientId : null)).filter(Boolean) as string[])];
    const clients = await this.prisma.client.findMany({ where: { id: { in: clientIdSet } }, select: { id: true, name: true, productCategory: true, invoiceNo: true } });
    const cmap = new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, company: c.productCategory, invoice: c.invoiceNo }]));

    const items = rows.map((m) => {
      const firstOf = (t: EventType) =>
        m.events.filter((e) => e.eventType === t).map((e) => e.occurredAt).sort((a, b) => +new Date(a) - +new Date(b))[0] ?? null;
      const openIps = new Set(
        m.events.filter((e) => e.eventType === EventType.OPEN).map((e) => (e.meta as { ip?: string } | null)?.ip).filter(Boolean),
      );
      const cohort = m.cohortId ? cohortMap.get(m.cohortId) : null;
      const clientId = m.campaign?.clientId ?? cohort?.clientId ?? null;
      const name = [m.contact?.firstName, m.contact?.lastName].filter(Boolean).join(' ').trim();
      return {
        id: m.id,
        subject: m.subject ?? '(no subject)',
        status: m.status,
        sentAt: m.sentAt,
        contact: m.contact ? { name: name || m.contact.email, email: m.contact.email, company: m.contact.company } : null,
        client: clientId ? cmap.get(clientId) ?? null : null,
        source: m.campaign ? { type: 'Campaign', name: m.campaign.name } : cohort ? { type: 'Cohort', name: cohort.label } : null,
        openedAt: firstOf(EventType.OPEN),
        clickedAt: firstOf(EventType.CLICK),
        repliedAt: firstOf(EventType.REPLY),
        bounced: m.status === MessageStatus.BOUNCED || m.events.some((e) => e.eventType === EventType.BOUNCE),
        forwarded: openIps.size >= 2,
        // Bounce/fail reason, from the BOUNCE event meta or the message error.
        reason: ((m.events.find((e) => e.eventType === EventType.BOUNCE)?.meta as { reason?: string } | null)?.reason) ?? m.error ?? null,
      };
    });
    return { items, total, page, pageSize };
  }

  /** Per-recipient event timeline for one message (the Email Log "Log" button). */
  async emailMessageLog(messageId: string) {
    const m = await this.prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true, subject: true, status: true, sentAt: true, createdAt: true, error: true,
        contact: { select: { email: true, firstName: true, lastName: true } },
        events: { orderBy: { occurredAt: 'asc' }, select: { eventType: true, occurredAt: true, meta: true } },
      },
    });
    if (!m) return { subject: null, contact: null, status: null, error: null, entries: [] };
    const LABEL: Record<string, string> = {
      DELIVERED: 'Delivered', OPEN: 'Opened', CLICK: 'Clicked', REPLY: 'Replied',
      BOUNCE: 'Bounced', UNSUBSCRIBE: 'Unsubscribed', COMPLAINT: 'Marked as spam', SENT: 'Sent',
    };
    const entries: { label: string; at: Date; detail: string | null }[] = [];
    if (m.sentAt) entries.push({ label: 'Sent', at: m.sentAt, detail: null });
    let sawBounce = false;
    for (const e of m.events) {
      if (e.eventType === EventType.SENT) continue; // sentAt already covers this
      const meta = e.meta as { url?: string; reason?: string } | null;
      const detail = e.eventType === EventType.CLICK ? meta?.url ?? null
        : e.eventType === EventType.BOUNCE ? (meta?.reason ?? m.error ?? null)
        : null;
      if (e.eventType === EventType.BOUNCE) sawBounce = true;
      entries.push({ label: LABEL[e.eventType] ?? e.eventType, at: e.occurredAt, detail });
    }
    // A FAILED (SMTP-rejected, never delivered) message has an error but no bounce event.
    if (!sawBounce && m.status === MessageStatus.FAILED && m.error) {
      entries.push({ label: 'Failed', at: m.sentAt ?? m.createdAt, detail: m.error });
    }
    entries.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const name = [m.contact?.firstName, m.contact?.lastName].filter(Boolean).join(' ').trim();
    return { subject: m.subject, contact: m.contact ? { name: name || m.contact.email, email: m.contact.email } : null, status: m.status, error: m.error, entries };
  }

  /**
   * Role-aware dashboard aggregates.
   *  - SUPER_ADMIN: whole tenant
   *  - SUB_ADMIN:   only assigned users
   *  - USER:        only their own data
   */
  async summary(user: AuthUser) {
    const scope = await this.scopeWhere(user);

    // Tenant-wide staff/approval counts are for admins only (not USER/CLIENT).
    const isAdmin =
      user.role === Role.SUPER_ADMIN || user.role === Role.SUB_ADMIN;
    const [campaigns, users, pendingApprovals, eventGroups] = await Promise.all([
      this.prisma.campaign.groupBy({
        by: ['status'],
        where: scope.campaign,
        _count: { _all: true },
      }),
      isAdmin
        ? this.prisma.user.count({ where: scope.user })
        : Promise.resolve(0),
      isAdmin
        ? this.prisma.approval.count({
            where: { tenantId: user.tenantId, status: 'PENDING' },
          })
        : Promise.resolve(0),
      this.prisma.emailEvent.groupBy({
        by: ['eventType'],
        where: { campaign: scope.campaign },
        _count: { _all: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const c of campaigns) byStatus[c.status] = c._count._all;

    // Email metrics: admins run the cohort engine, so their dashboard reflects
    // COHORT activity only (keeps it consistent with the cohort reports — no
    // legacy-campaign sends mixed in). Regular users see their own campaigns.
    const ev: Record<string, number> = {};
    if (user.role === Role.USER) {
      for (const g of eventGroups) ev[g.eventType] = g._count._all;
    }

    // Fold in the GRAPOUT cohort engine: its sends/opens/replies carry a
    // cohortId (no campaignId), so without this the dashboard would ignore all
    // cohort outreach. Admin-scoped (cohorts are tenant-level, not user-owned).
    let cohortCount = 0;
    let activeCohorts = 0;
    // null = all clients (super admin); [] or ids = the sub-admin's clients.
    const ccids = scope.cohortClientIds;
    const seeCohorts = user.role !== Role.USER && (ccids === null || ccids.length > 0);
    let scopedCohortIds: string[] | undefined;
    if (seeCohorts) {
      const cohortWhere = ccids === null ? {} : { clientId: { in: ccids } };
      // Message cohortId filter for events: restrict to scoped cohorts' ids.
      scopedCohortIds =
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

    // Forwarded (est.): messages opened from 2+ distinct IPs, across scope.
    // openedMsgIds tracks DISTINCT messages opened (any open, incl. pixel-less/no-IP) so
    // the open rate is unique-opens ÷ sent — repeat opens (Apple Mail pre-fetch, re-views)
    // can't push it past 100%.
    const ipsByMsg = new Map<string, Set<string>>();
    const openedMsgIds = new Set<string>();
    const collectOpens = (rows: { messageId: string; meta: unknown }[]) => {
      for (const r of rows) {
        openedMsgIds.add(r.messageId);
        const ip = (r.meta as { ip?: string } | null)?.ip;
        if (!ip) continue;
        if (!ipsByMsg.has(r.messageId)) ipsByMsg.set(r.messageId, new Set());
        ipsByMsg.get(r.messageId)!.add(ip);
      }
    };
    if (user.role === Role.USER) {
      collectOpens(
        await this.prisma.emailEvent.findMany({
          where: { campaign: scope.campaign, eventType: EventType.OPEN },
          select: { messageId: true, meta: true },
        }),
      );
    }
    if (seeCohorts) {
      collectOpens(
        await this.prisma.emailEvent.findMany({
          where: {
            eventType: EventType.OPEN,
            message: {
              tenantId: user.tenantId,
              cohortId: scopedCohortIds ? { in: scopedCohortIds } : { not: null },
            },
          },
          select: { messageId: true, meta: true },
        }),
      );
    }
    let forwarded = 0;
    for (const ips of ipsByMsg.values()) if (ips.size >= 2) forwarded++;

    // ── LinkedIn metrics (admins only; scoped to their clients, like cohorts) ──
    const li = { accountsConnected: 0, invitesSent: 0, connected: 0, leads: 0, replies: 0 };
    if (seeCohorts) {
      const acctWhere = ccids === null ? { tenantId: user.tenantId } : { clientId: { in: ccids } };
      const leadWhere = ccids === null ? { campaign: { tenantId: user.tenantId } } : { campaign: { clientId: { in: ccids } } };
      const [accts, leadStatuses] = await Promise.all([
        this.prisma.linkedInAccount.count({ where: { ...acctWhere, status: LinkedInAccountStatus.CONNECTED } }),
        this.prisma.liLead.groupBy({ by: ['status'], where: leadWhere, _count: { _all: true } }),
      ]);
      li.accountsConnected = accts;
      for (const g of leadStatuses) {
        const n = g._count._all;
        li.leads += n;
        if (g.status === 'CONNECTION_PENDING' || g.status === 'CONNECTED' || g.status === 'MESSAGED' || g.status === 'REPLIED') li.invitesSent += n;
        if (g.status === 'CONNECTED' || g.status === 'MESSAGED' || g.status === 'REPLIED') li.connected += n;
        if (g.status === 'REPLIED') li.replies += n;
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
      opens: openedMsgIds.size,
      clicks: ev[EventType.CLICK] ?? 0,
      replies: ev[EventType.REPLY] ?? 0,
      bounces: ev[EventType.BOUNCE] ?? 0,
      failed: ev[EventType.BOUNCE] ?? 0,
      forwarded,
      openRate: Math.min(100, rate(openedMsgIds.size)),
      clickRate: Math.min(100, rate(ev[EventType.CLICK] ?? 0)),
      replyRate: rate(ev[EventType.REPLY] ?? 0),
      bounceRate: rate(ev[EventType.BOUNCE] ?? 0),
      forwardRate: rate(forwarded),
      linkedin: {
        accountsConnected: li.accountsConnected,
        invitesSent: li.invitesSent,
        connected: li.connected,
        leads: li.leads,
        replies: li.replies,
        acceptanceRate: li.invitesSent ? Math.round((li.connected / li.invitesSent) * 1000) / 10 : 0,
        replyRate: li.connected ? Math.round((li.replies / li.connected) * 1000) / 10 : 0,
      },
    };
  }

  /** Recent cohorts across the tenant with live send/reply stats (dashboard). */
  async recentCohorts(user: AuthUser, take = 8) {
    if (user.role === Role.USER) return [];
    let clientFilter = {};
    if (user.role === Role.CLIENT) {
      const ids = await this.ownedClientIds(user.userId);
      clientFilter = { clientId: { in: ids } };
    }
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
      subIndex: c.subIndex,
      ref: cohortRef(c.monthIndex, c.subIndex),
      status: c.status,
      startDate: c.startDate,
      clientId: c.clientId,
      clientName: c.client?.name ?? null,
      contacts: total.get(c.id) ?? 0,
      sent: sent.get(c.id) ?? 0,
      replies: reps.get(c.id) ?? 0,
    }));
  }

  async activityLogs(user: AuthUser, take = 1000) {
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

    const [cohorts, mailboxes, campaigns, templates, contacts, imports, lists, liCampaigns] =
      await Promise.all([
        this.prisma.cohort.findMany({ where: { id: { in: idsOf(['Cohort', 'COHORT', 'Program']) } }, select: { id: true, clientId: true } }),
        this.prisma.emailAccount.findMany({ where: { id: { in: idsOf(['EmailAccount', 'SMTP', 'Mailbox']) } }, select: { id: true, clientId: true } }),
        this.prisma.campaign.findMany({ where: { id: { in: idsOf(['Campaign', 'CAMPAIGN']) } }, select: { id: true, clientId: true } }),
        this.prisma.emailTemplate.findMany({ where: { id: { in: idsOf(['EmailTemplate', 'Template', 'TEMPLATE']) } }, select: { id: true, clientId: true } }),
        this.prisma.contact.findMany({ where: { id: { in: idsOf(['Contact']) } }, select: { id: true, clientId: true } }),
        this.prisma.importJob.findMany({ where: { id: { in: idsOf(['ImportJob', 'IMPORT']) } }, select: { id: true, clientId: true } }),
        this.prisma.contactList.findMany({ where: { id: { in: idsOf(['ContactList', 'Contact']) } }, select: { id: true, clientId: true } }),
        this.prisma.liCampaign.findMany({ where: { id: { in: idsOf(['LiCampaign', 'LiPortal', 'LI_CAMPAIGN']) } }, select: { id: true, clientId: true } }),
      ]);

    const entClient = new Map<string, string | null>();
    for (const rows of [cohorts, mailboxes, campaigns, templates, contacts, imports, lists, liCampaigns])
      for (const r of rows) entClient.set(r.id, r.clientId);

    // Resolve all referenced client ids (+ 'Client' entities themselves) to names.
    const clientIds = new Set<string>([...idsOf(['Client'])]);
    // Generic audit entries: the entity may itself be a client, or carry a clientId.
    for (const l of logs) {
      if (l.entityId) clientIds.add(l.entityId);
      const cid = (l.after as { clientId?: unknown } | null)?.clientId;
      if (typeof cid === 'string') clientIds.add(cid);
    }
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
      if (!name && l.entityId) name = nameById.get(l.entityId);
      const after = l.after as { client?: unknown; clientId?: unknown } | null;
      if (!name && typeof after?.clientId === 'string') name = nameById.get(after.clientId);
      // Fallback: some logs embed the client name in their payload.
      if (!name && typeof after?.client === 'string') name = after.client;
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
    if (user.role === Role.CLIENT) {
      // A client-portal user only ever sees their own profiles' data.
      const ids = await this.ownedClientIds(user.userId);
      return {
        campaign: { tenantId: user.tenantId, clientId: { in: ids } },
        user: { tenantId: user.tenantId, id: user.userId },
        cohortClientIds: ids,
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

  async ownedClientIds(ownerUserId: string): Promise<string[]> {
    const rows = await this.prisma.client.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

/** Inclusive sent-date range → Prisma DateTime filter (end date covers the whole day). */
function emailDateRange(from?: string, to?: string): Prisma.DateTimeFilter | null {
  const r: Prisma.DateTimeFilter = {};
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) r.gte = d; }
  if (to) { const d = new Date(to); if (!Number.isNaN(d.getTime())) r.lte = new Date(d.getTime() + 86_400_000 - 1); }
  return r.gte || r.lte ? r : null;
}

/** Default Email Log view: the last 7 days by sent time. */
function defaultRecentRange(): Prisma.DateTimeFilter {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
  return { gte: start };
}
