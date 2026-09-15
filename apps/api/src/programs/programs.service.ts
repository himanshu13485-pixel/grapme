import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import {
  ApprovalEntity,
  ApprovalStatus,
  Client,
  ClientChangeKind,
  CohortStatus,
  Prisma,
  EmailAccount,
  EnrollmentStatus,
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
  Role,
  TemplateStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { renderTemplate } from '../templates/templates.service';
import { instrumentHtml } from '../sending/tracking.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../common/services/activity.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { GeoService } from '../common/services/geo.service';
import { cohortRef } from '../common/cohort-ref.util';
import {
  addBusinessDays,
  persistSequenceSteps,
  randomInt,
  withSendTime,
} from './schedule.util';
import {
  ADMIN_ONLY_CLIENT_FIELDS,
  CLIENT_FIELD_LABEL,
  CLIENT_REQUESTABLE_FIELDS,
  currentClientValue,
  normalizeClientValue,
  sameClientValue,
} from './client-settings';
import { LiCampaignsService } from '../linkedin/campaigns/li-campaigns.service';
import { LinkedInSubscriptionService } from '../linkedin/subscription/linkedin-subscription.service';
import { BounceService } from '../bounce/bounce.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { inStaffMailHour, istNow } from '../common/office-hours';
import { joinCsvList, splitCsvList } from '../common/csv-list';
import {
  AssignMailboxDto,
  CreateClientDto,
  CreateCohortDto,
  RenewClientDto,
  SequenceStepDto,
  SetSequenceDto,
  UpdateClientDto,
} from './dto/programs.dto';

@Injectable()
export class ProgramsService {
  private readonly logger = new Logger(ProgramsService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
    private activity: ActivityService,
    private geo: GeoService,
    private approvals: ApprovalsService,
    private liCampaigns: LiCampaignsService,
    private liSubs: LinkedInSubscriptionService,
    private bounce: BounceService,
    private subscriptions: SubscriptionsService,
  ) {}

  /**
   * Delete a client. Super admins delete immediately (cohorts/sequences/
   * enrollments cascade; mailboxes/contacts/lists/templates/campaigns are kept
   * and unlinked). A sub-admin's delete is submitted for super-admin approval.
   */
  async deleteClient(user: AuthUser, id: string) {
    const client = await this.assertClient(user, id);
    if (user.role === Role.SUPER_ADMIN) {
      await this.prisma.client.delete({ where: { id } });
      await this.activity.log({
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'DELETE_CLIENT',
        entityType: 'Client',
        entityId: id,
        before: { name: client.name },
      });
      return { ok: true, deleted: true };
    }
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.CLIENT_DELETE,
      entityId: id,
    });
    return { ok: true, pendingApproval: true };
  }

  /** Geo breakdown of opens/clicks for a client (optionally one cohort). */
  async cohortGeo(user: AuthUser, clientId: string, cohortId?: string) {
    await this.assertClient(user, clientId);
    const cohorts = await this.prisma.cohort.findMany({
      where: { clientId, tenantId: user.tenantId },
      select: { id: true },
    });
    let ids = cohorts.map((c) => c.id);
    if (cohortId) ids = ids.filter((i) => i === cohortId);
    const evs = await this.prisma.emailEvent.findMany({
      where: {
        message: { cohortId: { in: ids } },
        eventType: { in: [EventType.OPEN, EventType.CLICK] },
      },
      select: { eventType: true, meta: true },
    });
    return this.geo.aggregate(
      evs.map((e) => ({
        ip: (e.meta as { ip?: string } | null)?.ip ?? null,
        eventType: e.eventType as 'OPEN' | 'CLICK',
      })),
    );
  }

  // ── Clients ───────────────────────────────────────────────
  async createClient(user: AuthUser, dto: CreateClientDto) {
    // Client-portal users may add further profiles (e.g. one for Export and one
    // for Import — billed separately) but only up to their profileLimit. The new
    // profile is owned by them so it stays scoped to their panel.
    const ownerData: { ownerUserId?: string } = {};
    if (user.role === Role.CLIENT) {
      const [owned, me] = await Promise.all([
        this.prisma.client.count({
          where: { tenantId: user.tenantId, ownerUserId: user.userId },
        }),
        this.prisma.user.findUnique({ where: { id: user.userId } }),
      ]);
      const limit = me?.profileLimit ?? 1;
      if (owned >= limit) {
        throw new ForbiddenException(
          `Profile limit reached (${limit}). Contact your account manager to add another profile.`,
        );
      }
      ownerData.ownerUserId = user.userId;
    }
    // `linkedin` is the client's self-service send-window request — not a Client column.
    const { linkedin, validityDays, invoiceDate, operationContacts, ...clientData } = dto;
    // Staff-created workspaces must carry their invoice date and at least one operation
    // contact (the monthly buyers/suppliers reminder goes to them). A client setting up
    // its own workspace has neither yet, so both rules are for staff only.
    if (user.role !== Role.CLIENT && !invoiceDate) {
      throw new BadRequestException('Invoice date is required.');
    }
    const opsContacts = cleanOperationContacts(operationContacts);
    if (user.role !== Role.CLIENT && opsContacts.length === 0) {
      throw new BadRequestException('Add at least one operation contact.');
    }
    const opsData = opsContacts.length ? { operationContacts: opsContacts as Prisma.InputJsonValue } : {};
    const invoiceDateData = invoiceDate !== undefined ? { invoiceDate: invoiceDate ? new Date(invoiceDate) : null } : {};
    // Setting a validity window starts the clock now (mirrors the Validity menu).
    const validity: { validityDays?: number | null; validityStartAt?: Date | null } =
      validityDays === undefined ? {}
        : validityDays > 0 ? { validityDays: Math.floor(validityDays), validityStartAt: new Date() }
          : { validityDays: null, validityStartAt: null };
    // A CLIENT can't self-enable the paid LinkedIn channel: create the profile with
    // Email active as a baseline and route LinkedIn through admin approval instead.
    const clientRequestsLinkedIn = user.role === Role.CLIENT && !!clientData.linkedInEnabled;
    if (clientRequestsLinkedIn) {
      clientData.emailEnabled = true;
      clientData.linkedInEnabled = false;
    }
    const client = await this.prisma.client.create({
      // setupStartedAt starts the onboarding stopwatch from workspace creation.
      data: { tenantId: user.tenantId, setupStartedAt: new Date(), ...clientData, ...validity, ...invoiceDateData, ...opsData, ...ownerData },
    });

    // Seed the subscription history if the client starts with a validity window.
    if (client.validityDays && client.validityStartAt) {
      await this.subscriptions.record(user.tenantId, client.id, { plan: client.plan, validityDays: client.validityDays, source: 'registration' });
    }

    if (clientRequestsLinkedIn) {
      // Seed the subscription with the send window the client asked for, then queue
      // an approval; the admin approves to actually switch LinkedIn on.
      if (linkedin) {
        await this.liSubs.update(user.tenantId, client.id, { campaignDefaults: linkedin }).catch(() => undefined);
      }
      await this.approvals.submit({
        tenantId: user.tenantId,
        entityType: ApprovalEntity.LI_CHANNEL_REQUEST,
        entityId: client.id,
        submittedById: user.userId,
      });
    }

    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'CREATE_CLIENT',
      entityType: 'Client',
      entityId: client.id,
      after: { name: client.name, plan: client.plan },
    });
    return client;
  }

  /**
   * Admin: create a client workspace owned by an existing registered client login
   * (used from Registered Clients → "Create workspace" for sign-ups that never set
   * one up). Prefills company/email/mobile from the login; admin finishes the rest
   * in the Clients Workspace edit form.
   */
  async createWorkspaceForUser(
    admin: AuthUser,
    userId: string,
    dto: { name?: string; plan?: string },
  ) {
    this.assertAdmin(admin);
    const owner = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: admin.tenantId, role: Role.CLIENT },
      select: { id: true, name: true, email: true, companyName: true, contactMobile: true },
    });
    if (!owner) throw new NotFoundException('Client login not found');

    const name = (dto.name ?? '').trim() || owner.companyName || owner.name || 'New workspace';
    const client = await this.prisma.client.create({
      data: {
        tenantId: admin.tenantId,
        ownerUserId: owner.id,
        name,
        email: owner.email ?? null,
        mobile: owner.contactMobile ?? null,
        productCategory: owner.companyName ?? null,
        plan: (dto.plan ?? '').trim() || 'Growth',
      },
    });
    await this.activity.log({
      tenantId: admin.tenantId,
      actorId: admin.userId,
      action: 'CREATE_CLIENT',
      entityType: 'Client',
      entityId: client.id,
      after: { name: client.name, plan: client.plan, ownerUserId: owner.id },
    });
    return client;
  }

  /**
   * Admin (super only): hard-delete a Registered Clients row. For a client login,
   * this also deletes every workspace it owns (and their cohorts / campaigns /
   * data). For a login-less admin-created profile, deletes that profile. Irreversible.
   */
  async deleteRegistration(admin: AuthUser, source: string, id: string) {
    if (admin.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can delete registered clients.');
    }

    // Login-less admin-created client profile.
    if (source === 'profile') {
      const client = await this.prisma.client.findFirst({
        where: { id, tenantId: admin.tenantId, ownerUserId: null },
        select: { id: true, name: true },
      });
      if (!client) throw new NotFoundException('Profile not found');
      await this.prisma.$transaction([
        this.prisma.approval.deleteMany({ where: { entityId: id } }),
        this.prisma.client.delete({ where: { id } }),
      ]);
      await this.activity.log({
        tenantId: admin.tenantId, actorId: admin.userId, action: 'DELETE_CLIENT',
        entityType: 'Client', entityId: id, before: { name: client.name },
      });
      return { ok: true, deletedLogin: false, deletedClients: 1 };
    }

    // Client login (self-registered): delete the login + all workspaces it owns.
    const owner = await this.prisma.user.findFirst({
      where: { id, tenantId: admin.tenantId, role: Role.CLIENT },
      select: { id: true, email: true, name: true },
    });
    if (!owner) throw new NotFoundException('Client login not found');

    const clients = await this.prisma.client.findMany({
      where: { tenantId: admin.tenantId, ownerUserId: id },
      select: { id: true },
    });
    const clientIds = clients.map((c) => c.id);

    await this.prisma.$transaction([
      // Approvals block deletion (submittedById has no cascade); clear the user's
      // own submissions + any approvals for the workspaces being removed.
      this.prisma.approval.deleteMany({
        where: { OR: [{ submittedById: id }, ...(clientIds.length ? [{ entityId: { in: clientIds } }] : [])] },
      }),
      // Owned workspaces (cascades cohorts/enrollments; unlinks shared mailboxes).
      this.prisma.client.deleteMany({ where: { tenantId: admin.tenantId, ownerUserId: id } }),
      // The login itself (cascades its tokens, notifications, and anything it authored).
      this.prisma.user.delete({ where: { id } }),
    ]);

    await this.activity.log({
      tenantId: admin.tenantId, actorId: admin.userId, action: 'DELETE_CLIENT_LOGIN',
      entityType: 'User', entityId: id,
      before: { email: owner.email, name: owner.name, workspaces: clientIds.length },
    });
    return { ok: true, deletedLogin: true, deletedClients: clientIds.length };
  }

  private readonly clientListInclude = {
    _count: { select: { mailboxes: true, cohorts: true, enrollments: true, contacts: true } },
    owner: { select: { id: true, name: true, email: true, contactMobile: true, emailVerified: true, pendingEmail: true } },
    salesPerson: { select: { id: true, name: true, email: true } },
  } as const;

  async listClients(user: AuthUser) {
    const clients = await this.prisma.client.findMany({
      where: {
        tenantId: user.tenantId,
        // Client-portal users only see the profiles they own.
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.clientListInclude,
    });
    // Client portal: attach per-profile headline stats so the workspace card mirrors
    // the admin card (Sent / Opens / Clicks / Contacts + LinkedIn). Cheap — a client
    // owns only a handful of profiles.
    if (user.role !== Role.CLIENT) return clients;
    return Promise.all(
      clients.map(async (c) => {
        const [emailSent, emailOpens, emailClicks, liByStatus] = await Promise.all([
          this.prisma.emailMessage.count({ where: { emailAccount: { clientId: c.id }, direction: MessageDirection.OUTBOUND, status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] } } }),
          this.prisma.emailMessage.count({ where: { emailAccount: { clientId: c.id }, events: { some: { eventType: EventType.OPEN } } } }),
          this.prisma.emailMessage.count({ where: { emailAccount: { clientId: c.id }, events: { some: { eventType: EventType.CLICK } } } }),
          this.prisma.liLead.groupBy({ by: ['status'], where: { campaign: { clientId: c.id } }, _count: { _all: true } }),
        ]);
        let liLeads = 0, liConnected = 0, liInvites = 0;
        for (const g of liByStatus) {
          const n = g._count._all;
          liLeads += n;
          if (['CONNECTED', 'MESSAGED', 'REPLIED'].includes(g.status)) liConnected += n;
          if (['CONNECTION_PENDING', 'CONNECTED', 'MESSAGED', 'REPLIED'].includes(g.status)) liInvites += n;
        }
        return {
          ...c,
          stats: {
            emailSent, emailOpens, emailClicks,
            contacts: (c as { _count?: { contacts?: number } })._count?.contacts ?? 0,
            liInvites, liConnected, liLeads,
          },
        };
      }),
    );
  }

  /** Server-side paginated + filtered client list for the Workspace. */
  async listClientsPaged(
    user: AuthUser,
    query: {
      page?: string;
      pageSize?: string;
      q?: string;
      email?: string;
      invoice?: string;
      status?: string;
      plan?: string;
      salesPersonId?: string;
      linkedInEnabled?: string;
      channel?: string;
      expiryFrom?: string;
      expiryTo?: string;
      createdFrom?: string;
      createdTo?: string;
      invoiceFrom?: string;
      invoiceTo?: string;
    },
  ) {
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(query.pageSize ?? '12', 10) || 12),
    );
    const ci = (contains: string) =>
      ({ contains, mode: 'insensitive' }) as const;

    const and: Prisma.ClientWhereInput[] = [
      {
        tenantId: user.tenantId,
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
    ];
    // Subscription state (validityEndAt is a generated column: start + validity days):
    //  current     → active login window, not expired
    //  expired     → validity window elapsed
    //  deactivated → account switched off by an admin
    // ('active'/'inactive' kept as aliases for older links.)
    const now = new Date();
    const status = (query.status ?? '').toLowerCase();
    if (status === 'current' || status === 'active') {
      and.push({ status: { equals: 'active', mode: 'insensitive' } });
      if (status === 'current') {
        and.push({ OR: [{ validityEndAt: null }, { validityEndAt: { gte: now } }] });
      }
    } else if (status === 'deactivated' || status === 'inactive') {
      and.push({ status: { equals: 'inactive', mode: 'insensitive' } });
    } else if (status === 'expired') {
      and.push({ validityEndAt: { not: null, lt: now } });
    } else if (status === 'renewed') {
      and.push({ renewalCount: { gt: 0 } });
    }

    // Date-wise range — filters either the subscription expiry date or the client
    // creation date, depending on which field the caller supplies.
    const dateRange = (from?: string, to?: string): Prisma.DateTimeFilter | null => {
      const r: Prisma.DateTimeFilter = {};
      if (from) { const d = new Date(from); if (!isNaN(d.getTime())) r.gte = d; }
      // Inclusive end-of-day so a single day picked as "to" covers that whole day.
      if (to) { const d = new Date(to); if (!isNaN(d.getTime())) r.lte = new Date(d.getTime() + 86_400_000 - 1); }
      return r.gte || r.lte ? r : null;
    };
    const expiryRange = dateRange(query.expiryFrom, query.expiryTo);
    if (expiryRange) and.push({ validityEndAt: { not: null, ...expiryRange } });
    const createdRange = dateRange(query.createdFrom, query.createdTo);
    if (createdRange) and.push({ createdAt: createdRange });
    const invoiceRange = dateRange(query.invoiceFrom, query.invoiceTo);
    if (invoiceRange) and.push({ invoiceDate: { not: null, ...invoiceRange } });

    if (query.plan) and.push({ plan: query.plan });
    if (query.salesPersonId) {
      and.push(query.salesPersonId === 'none'
        ? { salesPersonId: null }
        : { salesPersonId: query.salesPersonId });
    }
    if (query.linkedInEnabled === 'true') and.push({ linkedInEnabled: true });
    // Channel filter — matches the card's label logic (email is on unless explicitly off).
    switch ((query.channel ?? '').toUpperCase()) {
      case 'EMAIL': and.push({ linkedInEnabled: false }); break;
      case 'LINKEDIN': and.push({ linkedInEnabled: true, emailEnabled: false }); break;
      case 'BOTH': and.push({ linkedInEnabled: true, emailEnabled: { not: false } }); break;
    }
    if (query.invoice) {
      // Match past invoices too, so a renewed client is still found by any invoice it
      // has ever had, not only the current one.
      const past = await this.prisma.subscriptionPeriod.findMany({
        where: { tenantId: user.tenantId, invoiceNo: ci(query.invoice) },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      and.push({ OR: [{ invoiceNo: ci(query.invoice) }, { id: { in: past.map((p) => p.clientId) } }] });
    }
    if (query.email) {
      and.push({
        OR: [
          { email: ci(query.email) },
          { owner: { email: ci(query.email) } },
        ],
      });
    }
    if (query.q) {
      and.push({
        OR: [
          { name: ci(query.q) },
          { plan: ci(query.q) },
          { invoiceNo: ci(query.q) },
          { email: ci(query.q) },
        ],
      });
    }
    const where: Prisma.ClientWhereInput = { AND: and };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.clientListInclude,
      }),
      this.prisma.client.count({ where }),
    ]);
    // Per-client headline stats for the Workspace card (Email: sent/opens/contacts;
    // LinkedIn: invites/connected/leads). Computed only for the visible page.
    const stats = await Promise.all(
      items.map(async (c) => {
        const [emailSent, emailOpens, emailClicks, liByStatus] = await Promise.all([
          this.prisma.emailMessage.count({
            where: { emailAccount: { clientId: c.id }, direction: MessageDirection.OUTBOUND, status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] } },
          }),
          // UNIQUE opens/clicks (distinct messages with ≥1 event) — matches the cohort
          // report's "real picture", not raw event totals.
          this.prisma.emailMessage.count({
            where: { emailAccount: { clientId: c.id }, events: { some: { eventType: EventType.OPEN } } },
          }),
          this.prisma.emailMessage.count({
            where: { emailAccount: { clientId: c.id }, events: { some: { eventType: EventType.CLICK } } },
          }),
          this.prisma.liLead.groupBy({ by: ['status'], where: { campaign: { clientId: c.id } }, _count: { _all: true } }),
        ]);
        let liLeads = 0, liConnected = 0, liInvites = 0;
        for (const g of liByStatus) {
          const n = g._count._all;
          liLeads += n;
          if (g.status === 'CONNECTED' || g.status === 'MESSAGED' || g.status === 'REPLIED') liConnected += n;
          if (g.status === 'CONNECTION_PENDING' || g.status === 'CONNECTED' || g.status === 'MESSAGED' || g.status === 'REPLIED') liInvites += n;
        }
        return { id: c.id, emailSent, emailOpens, emailClicks, liLeads, liConnected, liInvites };
      }),
    );
    const statsById = new Map(stats.map((s) => [s.id, s]));
    // The subscription each visible card renewed from: the latest period that began before
    // the current window. Shown as the card's one-line history.
    const periods = items.length
      ? await this.prisma.subscriptionPeriod.findMany({
          where: { clientId: { in: items.map((c) => c.id) } },
          orderBy: { startAt: 'desc' },
          select: { clientId: true, plan: true, invoiceNo: true, invoiceDate: true, startAt: true, endAt: true },
        })
      : [];
    const previousById = new Map<string, (typeof periods)[number]>();
    for (const c of items) {
      if (!c.validityStartAt) continue;
      const cutoff = c.validityStartAt.getTime() - 5 * 60_000;
      const prev = periods.find((p) => p.clientId === c.id && p.startAt.getTime() < cutoff);
      if (prev) previousById.set(c.id, prev);
    }
    const itemsWithStats = items.map((c) => {
      const s = statsById.get(c.id);
      return {
        ...c,
        previousSubscription: previousById.get(c.id) ?? null,
        stats: {
          emailSent: s?.emailSent ?? 0,
          emailOpens: s?.emailOpens ?? 0,
          emailClicks: s?.emailClicks ?? 0,
          contacts: c._count.contacts ?? 0,
          liInvites: s?.liInvites ?? 0,
          liConnected: s?.liConnected ?? 0,
          liLeads: s?.liLeads ?? 0,
        },
      };
    });
    return { items: itemsWithStats, total, page, pageSize };
  }

  /**
   * Registered clients directory (admin visibility into self-registration + spam).
   * A "row" is either a CLIENT login (self-registered, verified or not — may own 0
   * profiles) OR an admin-created client profile that has no login. Merged so admins
   * see every client identity in one place, including sign-ups that never built a
   * workspace ("No workspace") and admin-managed profiles ("No login").
   *
   * verified/status filters are login concepts, so when either is set only logins
   * are returned; the default (unfiltered) view includes login-less profiles.
   */
  async listRegisteredClients(
    user: AuthUser,
    query: { page?: string; pageSize?: string; q?: string; status?: string; verified?: string },
  ) {
    this.assertAdmin(user);
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '20', 10) || 20));
    const q = query.q?.trim();
    const ci = (contains: string) => ({ contains, mode: 'insensitive' }) as const;

    const userAnd: Prisma.UserWhereInput[] = [{ tenantId: user.tenantId, role: Role.CLIENT }];
    if (query.verified === 'true') userAnd.push({ emailVerified: true });
    if (query.verified === 'false') userAnd.push({ emailVerified: false });
    if (query.status) userAnd.push({ status: { equals: query.status.toUpperCase() as UserStatus } });
    if (q) userAnd.push({ OR: [{ name: ci(q) }, { email: ci(q) }, { companyName: ci(q) }] });

    const includeProfiles = !query.verified && !query.status;
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { AND: userAnd },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, companyName: true, contactMobile: true,
          status: true, emailVerified: true, lastLoginAt: true, createdAt: true,
          _count: { select: { ownedClients: true } },
        },
      }),
      includeProfiles
        ? this.prisma.client.findMany({
            where: {
              tenantId: user.tenantId,
              ownerUserId: null,
              ...(q ? { OR: [{ name: ci(q) }, { email: ci(q) }, { productCategory: ci(q) }] } : {}),
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, email: true, productCategory: true, mobile: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);

    const rows = [
      ...users.map((u) => ({
        id: u.id, source: 'login' as const, name: u.name, email: u.email,
        company: u.companyName ?? null, mobile: u.contactMobile ?? null,
        status: u.status, emailVerified: u.emailVerified as boolean | null,
        profiles: u._count.ownedClients, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt as Date | null,
      })),
      ...profiles.map((c) => ({
        id: c.id, source: 'profile' as const, name: c.name, email: c.email ?? '—',
        company: c.productCategory ?? null, mobile: c.mobile ?? null,
        status: (c.status ?? 'active').toUpperCase(), emailVerified: null as boolean | null,
        profiles: 1, createdAt: c.createdAt, lastLoginAt: null as Date | null,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    return { items, total, page, pageSize };
  }

  async getClient(user: AuthUser, id: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
      include: {
        owner: { select: { id: true, email: true, name: true, emailVerified: true, pendingEmail: true } },
        salesPerson: { select: { id: true, name: true, email: true } },
        mailboxes: {
          select: { id: true, label: true, emailAddress: true, status: true, rotationOrder: true },
          orderBy: { rotationOrder: 'asc' },
        },
        sequenceSteps: { where: { cohortId: null }, orderBy: { stageOrder: 'asc' } },
        _count: {
          select: {
            cohorts: true,
            enrollments: true,
            contacts: true,
            contactLists: true,
            templates: true,
            campaigns: true,
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  /**
   * A client-portal settings edit. Plan, entitlements, validity, billing,
   * channels and status are staff-only; any other change is held for review
   * and applied on approval. Nothing is written to the client here.
   */
  private async requestClientSettings(user: AuthUser, before: Client, dto: UpdateClientDto) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, raw] of Object.entries(dto)) {
      if (raw === undefined) continue;
      const to = normalizeClientValue(key, raw);
      const from = currentClientValue(before as unknown as Record<string, unknown>, key);
      if (sameClientValue(from, to)) continue;
      if (ADMIN_ONLY_CLIENT_FIELDS.includes(key)) {
        throw new ForbiddenException(
          `${CLIENT_FIELD_LABEL[key] ?? key} can only be changed by your account team.`,
        );
      }
      if (CLIENT_REQUESTABLE_FIELDS.includes(key)) changes[key] = { from, to };
    }
    if (Object.keys(changes).length === 0) return { ...before, pendingApproval: false };

    const listId = changes.autoCohortListId?.to;
    if (typeof listId === 'string' && listId) {
      const own = await this.prisma.contactList.count({
        where: { id: listId, tenantId: user.tenantId, clientId: before.id },
      });
      if (!own) throw new NotFoundException('Contact list not found');
    }
    await this.approvals.submitClientChange({
      tenantId: user.tenantId,
      clientId: before.id,
      requestedById: user.userId,
      kind: ClientChangeKind.SETTINGS,
      summary: 'Settings',
      payload: JSON.parse(JSON.stringify({ changes })),
    });
    return {
      ...before,
      pendingApproval: true,
      message: 'Settings change sent for approval. Your current settings stay in place until it is approved.',
    };
  }

  async updateClient(user: AuthUser, id: string, dto: UpdateClientDto) {
    const before = await this.assertClient(user, id);
    if (user.role === Role.CLIENT) return this.requestClientSettings(user, before, dto);
    // Validity is stored with a start date; changing the window (re)starts the clock.
    const { validityDays, operationContacts, invoiceDate, ...rest } = dto;
    // Invoice date is mandatory: it can be corrected but not cleared. Only an explicit
    // clear is refused — partial updates that don't touch it (ops contacts, approvals)
    // still go through for older clients that predate the rule.
    if (invoiceDate === '') throw new BadRequestException('Invoice date is required.');
    const data: Prisma.ClientUpdateInput = { ...rest };
    if (invoiceDate !== undefined) data.invoiceDate = invoiceDate ? new Date(invoiceDate) : null;
    if (operationContacts !== undefined) {
      // Mandatory: contacts can be changed but not all removed. Updates that don't send
      // the field still go through for older clients that have none yet.
      const clean = cleanOperationContacts(operationContacts);
      if (clean.length === 0) throw new BadRequestException('Add at least one operation contact.');
      // Persist as a plain JSON array of { name, email }.
      data.operationContacts = clean as Prisma.InputJsonValue;
    }
    if (validityDays !== undefined && validityDays !== (before.validityDays ?? 0)) {
      if (validityDays > 0) {
        data.validityDays = Math.floor(validityDays);
        data.validityStartAt = new Date();
        data.validityNotifyStage = 0;
      } else {
        data.validityDays = null;
        data.validityStartAt = null;
        data.validityNotifyStage = 0;
      }
    }
    const updated = await this.prisma.client.update({ where: { id }, data });
    // Log a subscription period when the plan or validity window changes via the edit
    // form, so plan upgrades/downgrades show in the renewal history (not just Renew).
    const planChanged = updated.plan !== before.plan;
    const validityChanged = validityDays !== undefined && validityDays !== (before.validityDays ?? 0);
    if ((planChanged || validityChanged) && updated.validityDays && updated.validityStartAt) {
      const endAt = new Date(new Date(updated.validityStartAt).getTime() + updated.validityDays * 86_400_000);
      await this.subscriptions.record(user.tenantId, id, { plan: updated.plan, validityDays: updated.validityDays, source: 'admin', endAt });
    }
    // Record only the fields that actually changed, so the audit trail is clear.
    const changedBefore: Record<string, unknown> = { name: before.name };
    const changedAfter: Record<string, unknown> = { name: updated.name };
    for (const k of Object.keys(dto) as (keyof UpdateClientDto)[]) {
      if ((before as Record<string, unknown>)[k] !== (updated as Record<string, unknown>)[k]) {
        changedBefore[k] = (before as Record<string, unknown>)[k];
        changedAfter[k] = (updated as Record<string, unknown>)[k];
      }
    }
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'Client',
      entityId: id,
      before: changedBefore,
      after: changedAfter,
    });
    return updated;
  }

  // ── Mailbox group ─────────────────────────────────────────
  async assignMailbox(user: AuthUser, clientId: string, dto: AssignMailboxDto) {
    this.assertAdmin(user); // Mailbox Group is staff-only
    const client = await this.assertClient(user, clientId);
    const mailbox = await this.prisma.emailAccount.findFirst({
      where: { id: dto.mailboxId, tenantId: user.tenantId },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
    // Enforce the plan's mailbox limit (0 = unlimited). Re-assigning an already-
    // assigned mailbox to the same client doesn't count against the limit.
    if (client.mailboxLimit && client.mailboxLimit > 0 && mailbox.clientId !== clientId) {
      const used = await this.prisma.emailAccount.count({ where: { clientId } });
      if (used >= client.mailboxLimit) {
        throw new BadRequestException(`Mailbox limit reached (${client.mailboxLimit}) for this client's plan.`);
      }
    }
    return this.prisma.emailAccount.update({
      where: { id: dto.mailboxId },
      data: { clientId, rotationOrder: dto.rotationOrder ?? 0 },
      select: { id: true, label: true, emailAddress: true, rotationOrder: true },
    });
  }

  async unassignMailbox(user: AuthUser, clientId: string, mailboxId: string) {
    this.assertAdmin(user);
    await this.assertClient(user, clientId);
    await this.prisma.emailAccount.updateMany({
      where: { id: mailboxId, tenantId: user.tenantId, clientId },
      data: { clientId: null, rotationOrder: 0 },
    });
    return { ok: true };
  }

  // ── Sequence ──────────────────────────────────────────────
  /** Replaces the steps for a scope (client default = cohortId null, or one
   *  cohort) deriving the engine's day-gap from each stage's planned month. */
  private async persistSteps(
    scope: { clientId: string; cohortId: string | null },
    steps: SequenceStepDto[],
  ) {
    return persistSequenceSteps(this.prisma, scope, steps);
  }

  /** Edit the client's DEFAULT sequence (template new cohorts start from). */
  async setSequence(user: AuthUser, clientId: string, dto: SetSequenceDto) {
    await this.assertClient(user, clientId);
    if (user.role === Role.CLIENT) {
      // Held for review; the live sequence keeps running until it's approved.
      await this.assertSequenceTemplates(user, clientId, dto.steps);
      const n = dto.steps.length;
      await this.approvals.submitClientChange({
        tenantId: user.tenantId,
        clientId,
        requestedById: user.userId,
        kind: ClientChangeKind.SEQUENCE,
        summary: `Default sequence · ${n} stage${n === 1 ? '' : 's'}`,
        payload: JSON.parse(JSON.stringify({ steps: dto.steps })),
      });
      return {
        pendingApproval: true,
        message: 'Sequence change sent for approval. The current sequence keeps running until it is approved.',
      };
    }
    await this.persistSteps({ clientId, cohortId: null }, dto.steps);
    const maxStage = dto.steps.reduce((m, s) => Math.max(m, s.stageOrder), 0);
    await this.prisma.client.update({
      where: { id: clientId },
      data: { followUpCount: maxStage },
    });
    return this.prisma.sequenceStep.findMany({
      where: { clientId, cohortId: null },
      orderBy: { stageOrder: 'asc' },
    });
  }

  /** A single cohort's own sequence (falls back to the client default if unset). */
  async getCohortSequence(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    const own = await this.prisma.sequenceStep.findMany({
      where: { cohortId },
      orderBy: { stageOrder: 'asc' },
    });
    if (own.length) return own;
    return this.prisma.sequenceStep.findMany({
      where: { clientId: cohort.clientId, cohortId: null },
      orderBy: { stageOrder: 'asc' },
    });
  }

  async setCohortSequence(user: AuthUser, cohortId: string, dto: SetSequenceDto) {
    const cohort = await this.assertCohort(user, cohortId);
    if (user.role === Role.CLIENT) {
      await this.assertSequenceTemplates(user, cohort.clientId, dto.steps);
      const n = dto.steps.length;
      await this.approvals.submitClientChange({
        tenantId: user.tenantId,
        clientId: cohort.clientId,
        requestedById: user.userId,
        kind: ClientChangeKind.COHORT_SEQUENCE,
        targetId: cohortId,
        summary: `Cohort ${cohortRef(cohort.monthIndex, cohort.subIndex)} sequence · ${n} stage${n === 1 ? '' : 's'}`,
        payload: JSON.parse(JSON.stringify({ steps: dto.steps })),
      });
      return {
        pendingApproval: true,
        message: 'Cohort sequence change sent for approval. This cohort keeps its current sequence until then.',
      };
    }
    await this.persistSteps({ clientId: cohort.clientId, cohortId }, dto.steps);
    return this.prisma.sequenceStep.findMany({
      where: { cohortId },
      orderBy: { stageOrder: 'asc' },
    });
  }

  // ── Cohorts & enrollment ──────────────────────────────────
  /** Manual upload: enroll a chosen list / contact set as a new cohort. */
  async createCohort(user: AuthUser, clientId: string, dto: CreateCohortDto) {
    const client = await this.assertClient(user, clientId);
    const isClient = user.role === Role.CLIENT;
    // A client-portal user can only enroll their own workspace's list / contacts.
    if (isClient && dto.listId) {
      const own = await this.prisma.contactList.count({
        where: { id: dto.listId, tenantId: user.tenantId, clientId },
      });
      if (!own) throw new NotFoundException('Contact list not found');
    }
    if (isClient && dto.contactIds?.length) {
      const wanted = new Set(dto.contactIds);
      const own = await this.prisma.contact.count({
        where: { id: { in: [...wanted] }, tenantId: user.tenantId, clientId },
      });
      if (own !== wanted.size) {
        throw new BadRequestException('Some of these contacts are not in this workspace.');
      }
    }
    const ids = new Set<string>(dto.contactIds ?? []);
    if (dto.listId) {
      const members = await this.prisma.contactListMember.findMany({
        where: { listId: dto.listId },
        select: { contactId: true },
      });
      members.forEach((m) => ids.add(m.contactId));
    }
    const contactIds = [...ids];
    if (contactIds.length === 0) {
      throw new BadRequestException('No contacts provided for the cohort');
    }

    // Fresh-only: a new month/cohort must target NEW people. Skip contacts
    // already enrolled for this client so the same person is never put in two
    // cohorts (which would double-email them and blur the monthly structure).
    const already = await this.prisma.enrollment.findMany({
      where: { clientId, contactId: { in: contactIds } },
      select: { contactId: true },
    });
    const enrolled = new Set(already.map((e) => e.contactId));
    const fresh = contactIds.filter((id) => !enrolled.has(id));
    if (fresh.length === 0) {
      throw new BadRequestException(
        'Every contact in this list is already enrolled for this client. ' +
          'For a new month, upload a list of NEW contacts.',
      );
    }

    // Label the cohort with its source list name (so you can see which list is running).
    let label = dto.label;
    if (!label && dto.listId) {
      const list = await this.prisma.contactList.findFirst({
        where: { id: dto.listId, tenantId: user.tenantId },
        select: { name: true },
      });
      label = list?.name;
    }
    const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
    const cohort = await this.createAndEnroll(
      client,
      fresh,
      label,
      dto.monthIndex,
      startDate,
      isClient ? CohortStatus.PENDING : CohortStatus.RUNNING,
    );
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'CREATE_COHORT',
      entityType: 'Cohort',
      entityId: cohort.cohortId,
      after: { label: label ?? null, contacts: fresh.length, client: client.name },
    });
    if (isClient) return this.submitCohortForApproval(user, cohort);
    return cohort;
  }

  /** Manual or auto: create the next cohort from the client's source list,
   *  taking only fresh contacts (not yet enrolled for this client). */
  async createCohortFromSource(
    user: AuthUser,
    clientId: string,
    listIdArg?: string,
  ) {
    const client = await this.assertClient(user, clientId);
    const listId = listIdArg ?? client.autoCohortListId ?? undefined;
    if (!listId) {
      throw new BadRequestException('No source list configured for this client');
    }
    const isClient = user.role === Role.CLIENT;
    if (isClient) {
      const own = await this.prisma.contactList.count({
        where: { id: listId, tenantId: user.tenantId, clientId },
      });
      if (!own) throw new NotFoundException('Contact list not found');
    }
    const cohort = await this.createFromSource(
      client,
      listId,
      isClient ? CohortStatus.PENDING : CohortStatus.RUNNING,
    );
    if (isClient) return this.submitCohortForApproval(user, cohort);
    return cohort;
  }

  /** A cohort a client created waits for review; nothing sends until it's approved. */
  private async submitCohortForApproval<T extends { cohortId: string }>(user: AuthUser, cohort: T) {
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.COHORT,
      entityId: cohort.cohortId,
    });
    return {
      ...cohort,
      pendingApproval: true,
      message: 'Cohort uploaded. It starts sending once an admin approves it.',
    };
  }

  private async createFromSource(
    client: Client,
    listId: string,
    status: CohortStatus = CohortStatus.RUNNING,
  ) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId },
      select: { name: true },
    });
    const members = await this.prisma.contactListMember.findMany({
      where: { listId },
      select: { contactId: true },
    });
    const listIds = members.map((m) => m.contactId);
    if (listIds.length === 0) {
      throw new BadRequestException('Source list is empty');
    }
    const existing = await this.prisma.enrollment.findMany({
      where: { clientId: client.id, contactId: { in: listIds } },
      select: { contactId: true },
    });
    const enrolled = new Set(existing.map((e) => e.contactId));
    const fresh = listIds
      .filter((id) => !enrolled.has(id))
      .slice(0, client.monthlyQuota);
    if (fresh.length === 0) {
      throw new BadRequestException('No fresh contacts left in the source list');
    }
    return this.createAndEnroll(client, fresh, list?.name, undefined, undefined, status);
  }

  /** Shared: create the Cohort row and enroll contacts with day-slot scheduling.
   *  startDate lets you upload a cohort in advance — sending begins on that date
   *  instead of immediately. Each cohort also gets its own copy of the default
   *  sequence so it can be customised without affecting other months. */
  private async createAndEnroll(
    client: Client,
    contactIds: string[],
    label?: string,
    monthIndexArg?: number,
    startDateArg?: Date,
    status: CohortStatus = CohortStatus.RUNNING,
  ) {
    const { monthIndex, subIndex } = await this.allocateMonthSlot(
      client.id,
      monthIndexArg,
    );

    // Don't start in the past; snap a past/empty start to now.
    const now = new Date();
    const start =
      startDateArg && startDateArg.getTime() > now.getTime()
        ? startDateArg
        : now;

    const cohort = await this.prisma.cohort.create({
      data: {
        tenantId: client.tenantId,
        clientId: client.id,
        label: label ?? `Month ${cohortRef(monthIndex, subIndex).slice(1)}`,
        monthIndex,
        subIndex,
        startDate: start,
        status,
      },
    });

    // Seed this cohort's own sequence from the client default (so it's editable).
    const defaultSteps = await this.prisma.sequenceStep.findMany({
      where: { clientId: client.id, cohortId: null },
      orderBy: { stageOrder: 'asc' },
    });
    for (const s of defaultSteps) {
      await this.prisma.sequenceStep.create({
        data: {
          clientId: client.id,
          cohortId: cohort.id,
          stageOrder: s.stageOrder,
          templateId: s.templateId,
          templateIds: s.templateIds ?? [],
          monthOffset: s.monthOffset,
          waitDays: s.waitDays,
        },
      });
    }

    let i = 0;
    for (const contactId of contactIds) {
      const daySlot = Math.floor(i / client.dailyBatchSize) + 1;
      // Stage-0 due on the (daySlot-1)-th business day, at a random time of day.
      const nextTouchAt = withSendTime(
        addBusinessDays(start, daySlot - 1),
        client.sendWindowStart,
        client.sendWindowEnd,
      );
      await this.prisma.enrollment.upsert({
        where: { cohortId_contactId: { cohortId: cohort.id, contactId } },
        update: {},
        create: {
          tenantId: client.tenantId,
          clientId: client.id,
          cohortId: cohort.id,
          contactId,
          stage: 0,
          daySlot,
          nextTouchAt,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      i++;
    }
    return {
      cohortId: cohort.id,
      enrolled: contactIds.length,
      monthIndex,
      subIndex,
      ref: cohortRef(monthIndex, subIndex),
    };
  }

  /** Decide which month a new cohort belongs to, and its letter within it.
   *
   *  No target month  -> the next month in the series (#4 after #3).
   *  A target month   -> the cohort joins that month as the next letter. The
   *                      cohort already in that month is relabelled from "#2"
   *                      to "#2A" so the pair reads #2A / #2B. That write
   *                      touches only the display field: enrollments,
   *                      sequences and send schedules never read subIndex, so
   *                      nothing already in flight changes. */
  private async allocateMonthSlot(
    clientId: string,
    monthIndexArg?: number,
  ): Promise<{ monthIndex: number; subIndex: number | null }> {
    const top = await this.prisma.cohort.findFirst({
      where: { clientId },
      orderBy: { monthIndex: 'desc' },
      select: { monthIndex: true },
    });
    const nextMonth = (top?.monthIndex ?? 0) + 1;

    if (monthIndexArg == null) return { monthIndex: nextMonth, subIndex: null };
    if (monthIndexArg < 1 || monthIndexArg > nextMonth) {
      throw new BadRequestException(
        `Month #${monthIndexArg} does not exist for this client. ` +
          `Pick an existing month, or leave it blank to start #${nextMonth}.`,
      );
    }

    const siblings = await this.prisma.cohort.findMany({
      where: { clientId, monthIndex: monthIndexArg },
      orderBy: { createdAt: 'asc' },
      select: { id: true, subIndex: true },
    });
    if (siblings.length === 0) {
      return { monthIndex: monthIndexArg, subIndex: null };
    }

    const used = siblings
      .map((c) => c.subIndex)
      .filter((n): n is number => n !== null);
    let next = used.length ? Math.max(...used) + 1 : 0;
    // Cohorts created before sub-cohorts existed carry no letter - give them
    // theirs (in creation order) so the month reads A, B, C without a gap.
    for (const c of siblings.filter((x) => x.subIndex === null)) {
      await this.prisma.cohort.update({
        where: { id: c.id },
        data: { subIndex: next },
      });
      next++;
    }
    return { monthIndex: monthIndexArg, subIndex: next };
  }

  listCohorts(user: AuthUser, clientId: string) {
    return this.prisma.cohort.findMany({
      where: { clientId, tenantId: user.tenantId },
      orderBy: [{ monthIndex: 'asc' }, { subIndex: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { enrollments: true } } },
    });
  }

  /** Cumulative per-stage timeline for a cohort from its resolved sequence.
   *  Used by BOTH the per-client cohort view and the global agenda so they
   *  always agree. maxStage = the cohort's own last stage (matches the engine). */
  private projectStages(
    startDate: Date,
    batchWindowDays: number,
    fallbackInterval: number,
    steps: { stageOrder: number; waitDays: number }[],
  ) {
    const waitByStage = new Map<number, number>();
    for (const s of steps) waitByStage.set(s.stageOrder, s.waitDays);
    const maxStage = steps.reduce((m, s) => Math.max(m, s.stageOrder), 0);
    const today = new Date();
    const out: Array<{
      stage: string;
      estStart: Date;
      estEnd: Date;
      state: 'done' | 'current' | 'upcoming';
    }> = [];
    let cursor = new Date(startDate);
    for (let stage = 0; stage <= maxStage; stage++) {
      const wait = waitByStage.get(stage) ?? (stage === 0 ? 0 : fallbackInterval);
      if (stage > 0) cursor = addBusinessDays(cursor, wait);
      const estStart = new Date(cursor);
      const estEnd = addBusinessDays(estStart, Math.max(0, batchWindowDays - 1));
      out.push({
        stage: stage === 0 ? 'Initial' : `Follow-up ${stage}`,
        estStart,
        estEnd,
        state: today > estEnd ? 'done' : today >= estStart ? 'current' : 'upcoming',
      });
    }
    return out;
  }

  /** Builds a resolver: each cohort's own steps, else the client default. */
  private async resolveSteps(clientId: string, cohortIds: string[]) {
    const allSteps = await this.prisma.sequenceStep.findMany({
      where: {
        OR: [{ cohortId: { in: cohortIds } }, { clientId, cohortId: null }],
      },
      select: { cohortId: true, stageOrder: true, waitDays: true },
      orderBy: { stageOrder: 'asc' },
    });
    const def = allSteps.filter((s) => s.cohortId === null);
    const byCohort = new Map<string, typeof allSteps>();
    for (const s of allSteps) {
      if (!s.cohortId) continue;
      const arr = byCohort.get(s.cohortId) ?? [];
      arr.push(s);
      byCohort.set(s.cohortId, arr);
    }
    return (cohortId: string) => {
      const own = byCohort.get(cohortId);
      return own && own.length ? own : def;
    };
  }

  /** Per-cohort live status breakdown for the dashboard. */
  /**
   * Turns an optional YYYY-MM-DD from/to pair into a filter on when an email
   * was SENT. `to` is inclusive to the end of that day, so picking one date
   * covers the whole of it. Anything never dispatched has a null sentAt, so it
   * falls back to createdAt rather than dropping out of every window.
   */
  private sentAtWindow(range?: { from?: string; to?: string }): Prisma.EmailMessageWhereInput {
    const parse = (v?: string) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const from = parse(range?.from);
    const toDay = parse(range?.to);
    const to = toDay ? new Date(toDay.getTime() + 86_400_000 - 1) : null;
    if (!from && !to) return {};
    const window: Prisma.DateTimeFilter = {};
    if (from) window.gte = from;
    if (to) window.lte = to;
    return { OR: [{ sentAt: window }, { AND: [{ sentAt: null }, { createdAt: window }] }] };
  }

  async cohortStats(
    user: AuthUser,
    clientId: string,
    range?: { from?: string; to?: string },
  ) {
    const client = await this.assertClient(user, clientId);
    // Optional reporting window, by the date the email actually went out.
    // Only the delivery/engagement metrics are windowed — cohort status, month
    // index and the projected schedule describe the cohort itself, not a period.
    const sentWindow = this.sentAtWindow(range);
    const cohorts = await this.prisma.cohort.findMany({
      where: { clientId, tenantId: user.tenantId },
      orderBy: [{ monthIndex: 'asc' }, { subIndex: 'asc' }, { createdAt: 'asc' }],
    });
    const now = new Date();
    const grouped = await this.prisma.enrollment.groupBy({
      by: ['cohortId', 'status'],
      where: { clientId },
      _count: { _all: true },
      _sum: { stage: true },
    });
    const dueGrouped = await this.prisma.enrollment.groupBy({
      by: ['cohortId'],
      where: {
        clientId,
        status: EnrollmentStatus.ACTIVE,
        nextTouchAt: { lte: now },
      },
      _count: { _all: true },
    });
    const dueMap = new Map(dueGrouped.map((d) => [d.cohortId, d._count._all]));
    // Next scheduled send per cohort = earliest upcoming touch among active rows.
    const nextGrouped = await this.prisma.enrollment.groupBy({
      by: ['cohortId'],
      where: { clientId, status: EnrollmentStatus.ACTIVE },
      _min: { nextTouchAt: true },
    });
    const nextMap = new Map(
      nextGrouped.map((n) => [n.cohortId, n._min.nextTouchAt]),
    );
    // Per-cohort projected schedule from each cohort's OWN sequence (same logic
    // the global agenda uses, so the two views always agree).
    const stepsFor = await this.resolveSteps(
      clientId,
      cohorts.map((c) => c.id),
    );

    // ── Delivery + engagement metrics per cohort ──
    const cohortIds = cohorts.map((c) => c.id);
    const msgGroups = await this.prisma.emailMessage.groupBy({
      by: ['cohortId', 'status'],
      where: {
        cohortId: { in: cohortIds },
        direction: MessageDirection.OUTBOUND,
        ...sentWindow,
      },
      _count: { _all: true },
    });
    const sentMsgs = new Map<string, number>();
    const bouncedMsgs = new Map<string, number>();
    for (const g of msgGroups) {
      if (!g.cohortId) continue;
      if (g.status === MessageStatus.SENT || g.status === MessageStatus.DELIVERED)
        sentMsgs.set(g.cohortId, (sentMsgs.get(g.cohortId) ?? 0) + g._count._all);
      if (g.status === MessageStatus.BOUNCED)
        bouncedMsgs.set(g.cohortId, (bouncedMsgs.get(g.cohortId) ?? 0) + g._count._all);
    }
    // Unique opens/clicks/replies (distinct message), and unsubscribe counts.
    const evs = await this.prisma.emailEvent.findMany({
      where: {
        // Windowed by the MESSAGE's send date, not the event date: the report
        // answers "of the mail sent in this period, how much was engaged with",
        // so a September open of an August send still counts against August.
        message: { cohortId: { in: cohortIds }, ...sentWindow },
        eventType: {
          in: [
            EventType.OPEN,
            EventType.CLICK,
            EventType.REPLY,
            EventType.UNSUBSCRIBE,
          ],
        },
      },
      select: {
        eventType: true,
        messageId: true,
        meta: true,
        message: { select: { cohortId: true } },
      },
    });
    const openSet = new Map<string, Set<string>>();
    const clickSet = new Map<string, Set<string>>();
    const replySet = new Map<string, Set<string>>();
    const unsubN = new Map<string, number>();
    // Per-message open IPs → a message opened from 2+ IPs was likely forwarded.
    const openIps = new Map<string, Set<string>>();
    const msgCohort = new Map<string, string>();
    const add = (m: Map<string, Set<string>>, cid: string, msg: string) => {
      if (!m.has(cid)) m.set(cid, new Set());
      m.get(cid)!.add(msg);
    };
    for (const e of evs) {
      const cid = e.message?.cohortId;
      if (!cid) continue;
      if (e.eventType === EventType.OPEN) {
        add(openSet, cid, e.messageId);
        msgCohort.set(e.messageId, cid);
        const ip = (e.meta as { ip?: string } | null)?.ip;
        if (ip) {
          if (!openIps.has(e.messageId)) openIps.set(e.messageId, new Set());
          openIps.get(e.messageId)!.add(ip);
        }
      } else if (e.eventType === EventType.CLICK) add(clickSet, cid, e.messageId);
      else if (e.eventType === EventType.REPLY) add(replySet, cid, e.messageId);
      else if (e.eventType === EventType.UNSUBSCRIBE)
        unsubN.set(cid, (unsubN.get(cid) ?? 0) + 1);
    }
    // Forwarded (estimated) per cohort = messages opened from 2+ distinct IPs.
    const forwardedByCohort = new Map<string, number>();
    for (const [msgId, ips] of openIps) {
      if (ips.size >= 2) {
        const cid = msgCohort.get(msgId);
        if (cid) forwardedByCohort.set(cid, (forwardedByCohort.get(cid) ?? 0) + 1);
      }
    }
    const metricsFor = (cid: string) => {
      const s = sentMsgs.get(cid) ?? 0;
      const opens = openSet.get(cid)?.size ?? 0;
      const clicks = clickSet.get(cid)?.size ?? 0;
      const replies = replySet.get(cid)?.size ?? 0;
      const bounces = bouncedMsgs.get(cid) ?? 0;
      const forwarded = forwardedByCohort.get(cid) ?? 0;
      const pct = (n: number) => (s ? Math.round((n / s) * 1000) / 10 : 0);
      // Delivered = accepted by the receiving server (sent that didn't bounce).
      const attempts = s + bounces;
      const deliveryRate = attempts ? Math.round((s / attempts) * 1000) / 10 : 0;
      return {
        sent: s,
        delivered: s,
        opens,
        clicks,
        replies,
        bounces,
        unsubscribes: unsubN.get(cid) ?? 0,
        forwarded,
        deliveryRate,
        openRate: pct(opens),
        clickRate: pct(clicks),
        replyRate: pct(replies),
        bounceRate: pct(bounces),
        forwardRate: pct(forwarded),
      };
    };

    return cohorts.map((co) => {
      const schedule = this.projectStages(
        co.startDate,
        client.batchWindowDays,
        client.stageIntervalDays,
        stepsFor(co.id),
      );
      const rows = grouped.filter((g) => g.cohortId === co.id);
      const byStatus: Record<string, number> = {};
      let total = 0;
      let sent = 0;
      let completed = 0;
      for (const r of rows) {
        const cnt = r._count._all;
        byStatus[r.status] = cnt;
        total += cnt;
        sent += r._sum.stage ?? 0; // stage == touches already sent for active rows
        if (r.status === 'COMPLETED') completed += cnt;
      }
      sent += completed; // completed rows sent one more than their stored stage
      return {
        id: co.id,
        label: co.label,
        monthIndex: co.monthIndex,
        subIndex: co.subIndex,
        ref: cohortRef(co.monthIndex, co.subIndex),
        status: co.status,
        startDate: co.startDate,
        endedAt: co.endedAt,
        nextSendAt: nextMap.get(co.id) ?? null,
        estEndAt: schedule[schedule.length - 1]?.estEnd ?? co.startDate,
        schedule,
        total,
        active: byStatus['ACTIVE'] ?? 0,
        due: dueMap.get(co.id) ?? 0,
        replied: byStatus['REPLIED'] ?? 0,
        completed: byStatus['COMPLETED'] ?? 0,
        stopped: byStatus['STOPPED'] ?? 0,
        sent,
        metrics: metricsFor(co.id),
      };
    });
  }

  /** Tenant-wide agenda: every upcoming send across all running cohorts of all
   *  clients, in date order (for the global "daily line-up" view). */
  async agenda(user: AuthUser) {
    const clients = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId },
      select: {
        id: true,
        name: true,
        batchWindowDays: true,
        followUpCount: true,
        stageIntervalDays: true,
      },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const cohorts = await this.prisma.cohort.findMany({
      where: { tenantId: user.tenantId, status: 'RUNNING' },
      select: {
        id: true,
        clientId: true,
        label: true,
        monthIndex: true,
        subIndex: true,
        startDate: true,
      },
    });

    // Resolve steps across this tenant's cohorts in one query (own, else default).
    const cohortIdsByClient = new Map<string, string[]>();
    for (const co of cohorts) {
      const arr = cohortIdsByClient.get(co.clientId) ?? [];
      arr.push(co.id);
      cohortIdsByClient.set(co.clientId, arr);
    }
    const resolverByClient = new Map<
      string,
      (cohortId: string) => { stageOrder: number; waitDays: number }[]
    >();
    for (const [cid, ids] of cohortIdsByClient) {
      resolverByClient.set(cid, await this.resolveSteps(cid, ids));
    }

    const rows: Array<{
      clientName: string;
      cohortLabel: string;
      monthIndex: number;
      cohortRef: string;
      stage: string;
      estStart: Date;
      estEnd: Date;
      state: 'current' | 'upcoming';
    }> = [];

    for (const co of cohorts) {
      const client = clientMap.get(co.clientId);
      const stepsFor = resolverByClient.get(co.clientId);
      if (!client || !stepsFor) continue;
      const schedule = this.projectStages(
        co.startDate,
        client.batchWindowDays,
        client.stageIntervalDays,
        stepsFor(co.id),
      );
      for (const s of schedule) {
        if (s.state === 'done') continue;
        rows.push({
          clientName: client.name,
          cohortLabel: co.label,
          monthIndex: co.monthIndex,
          cohortRef: cohortRef(co.monthIndex, co.subIndex),
          stage: s.stage,
          estStart: s.estStart,
          estEnd: s.estEnd,
          state: s.state,
        });
      }
    }
    rows.sort((a, b) => a.estStart.getTime() - b.estStart.getTime());
    return rows;
  }

  // ── Cohort lifecycle: pause / resume / stop ───────────────
  private logCohort(
    user: AuthUser,
    action: string,
    cohort: {
      id: string;
      label: string;
      monthIndex: number;
      subIndex?: number | null;
    },
  ) {
    return this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action,
      entityType: 'Cohort',
      entityId: cohort.id,
      after: {
        label: cohort.label,
        month: cohortRef(cohort.monthIndex, cohort.subIndex),
      },
    });
  }

  async pauseCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    if (cohort.status !== CohortStatus.RUNNING) {
      throw new BadRequestException(
        cohort.status === CohortStatus.PENDING ? 'This cohort is awaiting approval.' : 'Only a running cohort can be paused.',
      );
    }
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'PAUSED' },
    });
    await this.logCohort(user, 'PAUSE_COHORT', cohort);
    return { ok: true };
  }

  async resumeCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    // Resume never starts a cohort that hasn't been approved.
    if (cohort.status !== CohortStatus.PAUSED) {
      throw new BadRequestException(
        cohort.status === CohortStatus.PENDING ? 'This cohort is awaiting approval.' : 'Only a paused cohort can be resumed.',
      );
    }
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'RUNNING' },
    });
    await this.logCohort(user, 'RESUME_COHORT', cohort);
    return { ok: true };
  }

  /** Stop permanently: halt the cohort and end every still-active contact. */
  async stopCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    if (cohort.status === CohortStatus.PENDING) {
      throw new BadRequestException('This cohort is still awaiting approval. Delete it instead.');
    }
    if (cohort.status === CohortStatus.STOPPED || cohort.status === CohortStatus.COMPLETED) {
      throw new BadRequestException('This cohort has already ended.');
    }
    if (user.role === Role.CLIENT) {
      return this.requestCohortAction(user, cohort, ClientChangeKind.COHORT_STOP);
    }
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'STOPPED', endedAt: new Date() },
    });
    await this.prisma.enrollment.updateMany({
      where: { cohortId, status: EnrollmentStatus.ACTIVE },
      data: { status: EnrollmentStatus.STOPPED },
    });
    await this.logCohort(user, 'STOP_COHORT', cohort);
    return { ok: true };
  }

  /** Delete a cohort and all its enrollments (cascade). */
  async deleteCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    // A client removes a cohort that never sent (still awaiting approval) right
    // away — that frees its contacts. Deleting a live one is a request.
    if (user.role === Role.CLIENT && cohort.status !== CohortStatus.PENDING) {
      return this.requestCohortAction(user, cohort, ClientChangeKind.COHORT_DELETE);
    }
    await this.prisma.cohort.delete({ where: { id: cohortId } });
    await this.closeCohortApprovals(user.tenantId, cohortId);
    await this.logCohort(user, 'DELETE_COHORT', cohort);
    return { ok: true };
  }

  /**
   * Emergency control: pause / resume / stop EVERY cohort in the tenant at once.
   *  - pause: all RUNNING → PAUSED (reversible)
   *  - resume: all PAUSED → RUNNING
   *  - stop: all RUNNING/PAUSED → STOPPED and end their active enrollments
   */
  async controlAllCohorts(user: AuthUser, action: 'pause' | 'resume' | 'stop') {
    this.assertAdmin(user); // tenant-wide: every client's cohorts
    const tenantId = user.tenantId;
    let affected = 0;
    if (action === 'pause') {
      const r = await this.prisma.cohort.updateMany({
        where: { tenantId, status: 'RUNNING' },
        data: { status: 'PAUSED' },
      });
      affected = r.count;
    } else if (action === 'resume') {
      const r = await this.prisma.cohort.updateMany({
        where: { tenantId, status: 'PAUSED' },
        data: { status: 'RUNNING' },
      });
      affected = r.count;
    } else {
      const cohorts = await this.prisma.cohort.findMany({
        where: { tenantId, status: { in: ['RUNNING', 'PAUSED'] } },
        select: { id: true },
      });
      const ids = cohorts.map((c) => c.id);
      const r = await this.prisma.cohort.updateMany({
        where: { id: { in: ids } },
        data: { status: 'STOPPED', endedAt: new Date() },
      });
      await this.prisma.enrollment.updateMany({
        where: { cohortId: { in: ids }, status: EnrollmentStatus.ACTIVE },
        data: { status: EnrollmentStatus.STOPPED },
      });
      affected = r.count;
    }
    await this.activity.log({
      tenantId,
      actorId: user.userId,
      action: `${action.toUpperCase()}_ALL_COHORTS`,
      entityType: 'Cohort',
      after: { affected },
    });
    return { action, affected };
  }

  /** Send now: make this cohort's active contacts due immediately, then run the
   *  engine. Per-mailbox daily caps still throttle the actual volume. */
  async sendCohortNow(user: AuthUser, cohortId: string) {
    this.assertAdmin(user);
    const cohort = await this.assertCohort(user, cohortId);
    if (cohort.status !== CohortStatus.RUNNING) {
      throw new BadRequestException('Only a running cohort can send now.');
    }
    await this.prisma.enrollment.updateMany({
      where: { cohortId, status: EnrollmentStatus.ACTIVE },
      data: { nextTouchAt: new Date() },
    });
    return this.runDueNow();
  }

  /** A client's stop/delete of a live cohort becomes a change request for review. */
  private async requestCohortAction(
    user: AuthUser,
    cohort: { id: string; clientId: string; label: string; monthIndex: number; subIndex: number | null },
    kind: ClientChangeKind,
  ) {
    const verb = kind === ClientChangeKind.COHORT_STOP ? 'Stop' : 'Delete';
    const res = await this.approvals.submitClientChange({
      tenantId: user.tenantId,
      clientId: cohort.clientId,
      requestedById: user.userId,
      kind,
      targetId: cohort.id,
      summary: `${verb} cohort ${cohortRef(cohort.monthIndex, cohort.subIndex)} · ${cohort.label}`,
      payload: {},
    });
    return {
      ok: true,
      pendingApproval: true,
      message: res.duplicate
        ? `A ${verb.toLowerCase()} request for this cohort is already awaiting approval.`
        : `${verb} request sent for approval. The cohort stays as it is until then.`,
    };
  }

  /** Close reviews that would otherwise point at a cohort that no longer exists. */
  private async closeCohortApprovals(tenantId: string, cohortId: string) {
    const changeIds = (
      await this.prisma.clientChangeRequest.findMany({
        where: { tenantId, targetId: cohortId },
        select: { id: true },
      })
    ).map((r) => r.id);
    await this.prisma.approval.updateMany({
      where: {
        tenantId,
        status: ApprovalStatus.PENDING,
        OR: [
          { entityType: ApprovalEntity.COHORT, entityId: cohortId },
          { entityType: ApprovalEntity.CLIENT_CHANGE, entityId: { in: changeIds } },
        ],
      },
      data: {
        status: ApprovalStatus.REJECTED,
        decisionReason: 'Cohort deleted before review',
        decidedAt: new Date(),
      },
    });
  }

  /** Templates a client puts in a sequence must belong to that workspace. */
  private async assertSequenceTemplates(
    user: AuthUser,
    clientId: string,
    steps: SequenceStepDto[],
  ) {
    if (user.role !== Role.CLIENT) return;
    const ids = [
      ...new Set(
        steps
          .flatMap((st) => [st.templateId, ...(st.templateIds ?? [])])
          .map((t) => (t ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (!ids.length) return;
    const own = await this.prisma.emailTemplate.count({
      where: { id: { in: ids }, tenantId: user.tenantId, clientId },
    });
    if (own !== ids.length) {
      throw new BadRequestException('A selected template is not in this workspace.');
    }
  }

  private async assertCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.prisma.cohort.findFirst({
      where: {
        id: cohortId,
        tenantId: user.tenantId,
        // A client-portal user can only reach cohorts of a workspace they own.
        ...(user.role === Role.CLIENT ? { client: { ownerUserId: user.userId } } : {}),
      },
    });
    if (!cohort) throw new NotFoundException('Cohort not found');
    return cohort;
  }

  /** Cron: create this month's cohort for every auto-enabled client that's due. */
  async runAutoCohorts(): Promise<{ created: number }> {
    const now = new Date();
    const day = now.getDate();
    const clients = await this.prisma.client.findMany({
      where: { autoCohortEnabled: true, autoCohortListId: { not: null } },
    });
    let created = 0;
    for (const c of clients) {
      if (day < c.autoCohortDay) continue;
      if (
        c.lastAutoCohortAt &&
        c.lastAutoCohortAt.getFullYear() === now.getFullYear() &&
        c.lastAutoCohortAt.getMonth() === now.getMonth()
      ) {
        continue; // already created this month
      }
      try {
        await this.createFromSource(c, c.autoCohortListId as string);
        await this.prisma.client.update({
          where: { id: c.id },
          data: { lastAutoCohortAt: now },
        });
        created++;
      } catch (e) {
        this.logger.warn(`Auto-cohort skipped for ${c.name}: ${e}`);
      }
    }
    if (created) this.logger.log(`Auto-cohort: created ${created} cohort(s)`);
    return { created };
  }

  // ── The engine: send everything due across all clients ────
  async runDueNow(): Promise<{ sent: number; skipped: number }> {
    const now = new Date();
    let sent = 0;
    let skipped = 0;

    // Plan-expiry reminders, then expire validity: flip lapsed clients to
    // inactive + pause cohorts.
    await this.notifyValidityMilestones();
    await this.enforceClientValidity();
    // Monthly nudge to sales/ops that next month's campaign data is due.
    await this.notifyCampaignDataDue();

    const due = await this.prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        nextTouchAt: { lte: now },
        cohort: { status: 'RUNNING' }, // skip paused/stopped cohorts
      },
      orderBy: { nextTouchAt: 'asc' },
      include: { client: true },
      take: 1000,
    });
    if (due.length === 0) return { sent, skipped };

    // Group due enrollments by client so rotation/caps are per mailbox-group.
    const byClient = new Map<string, typeof due>();
    for (const e of due) {
      const arr = byClient.get(e.clientId) ?? [];
      arr.push(e);
      byClient.set(e.clientId, arr);
    }

    for (const [clientId, enrollments] of byClient) {
      const client = enrollments[0].client;
      // Never send for a deactivated or validity-expired client.
      if (!this.isClientActive(client)) {
        skipped += enrollments.length;
        continue;
      }
      // Send only on the client's selected days (0=Sun … 6=Sat). Falls back to
      // Mon–Fri if unset. Supersedes the legacy weekdaysOnly flag.
      const sendDays = client.workDays?.length ? client.workDays : [1, 2, 3, 4, 5];
      if (!sendDays.includes(now.getDay())) {
        skipped += enrollments.length;
        continue;
      }

      const mailboxes = await this.eligibleMailboxes(clientId);
      if (mailboxes.length === 0) {
        skipped += enrollments.length;
        continue;
      }

      // Resolve the sequence per cohort: a cohort's OWN steps, else the client
      // default (cohortId null). Each cohort can run a different sequence.
      const cohortIds = [...new Set(enrollments.map((e) => e.cohortId))];
      const allSteps = await this.prisma.sequenceStep.findMany({
        where: {
          OR: [{ cohortId: { in: cohortIds } }, { clientId, cohortId: null }],
        },
        orderBy: { stageOrder: 'asc' },
      });
      const defaultSteps = allSteps.filter((s) => s.cohortId === null);
      const stepsByCohort = new Map<string, typeof allSteps>();
      for (const s of allSteps) {
        if (!s.cohortId) continue;
        const arr = stepsByCohort.get(s.cohortId) ?? [];
        arr.push(s);
        stepsByCohort.set(s.cohortId, arr);
      }
      const stepsFor = (cohortId: string) => {
        const own = stepsByCohort.get(cohortId);
        return own && own.length ? own : defaultSteps;
      };

      // Per-mailbox throttle: today's send count (daily cap) + last send time
      // (for a human-like randomized gap between consecutive sends).
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = new Map<string, number>();
      const lastSentMs = new Map<string, number>();
      for (const mb of mailboxes) {
        sentToday.set(
          mb.id,
          await this.prisma.emailMessage.count({
            where: {
              emailAccountId: mb.id,
              direction: MessageDirection.OUTBOUND,
              status: MessageStatus.SENT,
              sentAt: { gte: startOfDay },
            },
          }),
        );
        const last = await this.prisma.emailMessage.findFirst({
          where: {
            emailAccountId: mb.id,
            direction: MessageDirection.OUTBOUND,
            status: MessageStatus.SENT,
          },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        });
        lastSentMs.set(mb.id, last?.sentAt ? last.sentAt.getTime() : 0);
      }
      const nowMs = now.getTime();

      // Never email contacts who unsubscribed / bounced or are on the tenant
      // suppression list — mirror the campaign path for the cohort engine.
      const contactMap = new Map(
        (
          await this.prisma.contact.findMany({
            where: { id: { in: enrollments.map((e) => e.contactId) } },
            select: { id: true, email: true, status: true },
          })
        ).map((c) => [c.id, c]),
      );
      const suppressed = new Set(
        (
          await this.prisma.suppression.findMany({
            where: { tenantId: client.tenantId },
            select: { email: true },
          })
        ).map((s) => s.email.toLowerCase()),
      );

      let rot = 0;
      for (const enr of enrollments) {
        const contact = contactMap.get(enr.contactId);
        if (
          !contact ||
          contact.status !== 'ACTIVE' ||
          suppressed.has(contact.email.toLowerCase())
        ) {
          // Opted out / suppressed: stop this enrollment so it's never retried.
          await this.prisma.enrollment.update({
            where: { id: enr.id },
            data: { status: EnrollmentStatus.STOPPED },
          });
          skipped++;
          continue;
        }

        // Stop if the contact has replied (any recorded REPLY for them).
        const replied = await this.prisma.emailEvent.findFirst({
          where: {
            eventType: EventType.REPLY,
            message: { contactId: enr.contactId, tenantId: client.tenantId },
          },
        });
        if (replied) {
          await this.prisma.enrollment.update({
            where: { id: enr.id },
            data: { status: EnrollmentStatus.REPLIED },
          });
          continue;
        }

        const cohortSteps = stepsFor(enr.cohortId);
        const maxStage = cohortSteps.reduce(
          (m, s) => Math.max(m, s.stageOrder),
          0,
        );
        // Advance an enrollment past a stage WITHOUT sending (used when the
        // stage has no template, or after a successful send): move to the next
        // stage scheduled by that stage's own waitDays, else complete.
        const advanceStage = (current: number) => {
          const nextStage = current + 1;
          if (nextStage > maxStage) {
            return this.prisma.enrollment.update({
              where: { id: enr.id },
              data: { status: EnrollmentStatus.COMPLETED, lastSentAt: now },
            });
          }
          const jitter = client.stageIntervalJitterDays;
          const baseWait =
            cohortSteps.find((s) => s.stageOrder === nextStage)?.waitDays ??
            client.stageIntervalDays;
          const gap = Math.max(1, baseWait + randomInt(-jitter, jitter));
          const nextTouchAt = withSendTime(
            addBusinessDays(now, gap),
            client.sendWindowStart,
            client.sendWindowEnd,
          );
          return this.prisma.enrollment.update({
            where: { id: enr.id },
            data: { stage: nextStage, nextTouchAt },
          });
        };

        const stepForStage = cohortSteps.find(
          (s) => s.stageOrder === enr.stage,
        );
        // Per-mailbox variants: the array is indexed by mailbox rotation slot.
        const variantList = (
          Array.isArray(stepForStage?.templateIds)
            ? (stepForStage!.templateIds as unknown[])
            : []
        ).map((v) => (typeof v === 'string' ? v : ''));
        const filledVariants = variantList.filter((v) => v);
        const fallbackVariants = filledVariants.length
          ? filledVariants
          : stepForStage?.templateId
            ? [stepForStage.templateId]
            : [];
        if (fallbackVariants.length === 0) {
          // Empty touch (e.g. a skipped month): pass through to the next stage
          // instead of stalling here forever so later filled stages still fire.
          await advanceStage(enr.stage);
          skipped++;
          continue;
        }

        // Find a mailbox that is under its daily cap AND has waited a randomized
        // gap (~sendSpeedSeconds ±40%) since its last send — so mail trickles out
        // at human-like, non-uniform intervals instead of all at once.
        let chosenIdx = -1;
        for (let k = 0; k < mailboxes.length; k++) {
          const idx = (rot + k) % mailboxes.length;
          const mb = mailboxes[idx];
          if ((sentToday.get(mb.id) ?? 0) >= mb.dailyLimit) continue;
          const base = mb.sendSpeedSeconds || 90;
          const gapMs =
            randomInt(Math.floor(base * 0.6), Math.ceil(base * 1.4)) * 1000;
          if (nowMs - (lastSentMs.get(mb.id) ?? 0) < gapMs) continue;
          chosenIdx = idx;
          break;
        }
        if (chosenIdx === -1) {
          // Every mailbox is at cap or still within its send gap — leave the
          // rest for the next engine tick so sending stays spaced out.
          skipped++;
          continue;
        }
        rot = chosenIdx + 1;
        const mailbox = mailboxes[chosenIdx];

        // Each mailbox sends its OWN variant (by rotation slot) to vary the
        // sending footprint; fall back to round-robin over the filled variants
        // when this slot has none set.
        const templateId =
          variantList[chosenIdx] ||
          fallbackVariants[chosenIdx % fallbackVariants.length];

        const ok = await this.sendOne(enr, mailbox, templateId);
        if (ok) {
          sent++;
          sentToday.set(mailbox.id, (sentToday.get(mailbox.id) ?? 0) + 1);
          lastSentMs.set(mailbox.id, nowMs);
          // Record the send, then advance (capped by THIS cohort's own length).
          await this.prisma.enrollment.update({
            where: { id: enr.id },
            data: { lastSentAt: now },
          });
          await advanceStage(enr.stage);
        } else {
          skipped++;
        }
      }
    }

    if (sent || skipped) {
      this.logger.log(`Cohort engine tick: sent ${sent}, skipped ${skipped}`);
    }
    return { sent, skipped };
  }

  /** Active mailboxes in a client's group, in rotation order. */
  private async eligibleMailboxes(clientId: string) {
    return this.prisma.emailAccount.findMany({
      where: { clientId, status: MailboxStatus.ACTIVE },
      orderBy: { rotationOrder: 'asc' },
    });
  }

  /** Renders + sends one enrollment email through the chosen mailbox. */
  private async sendOne(
    enr: { id: string; tenantId: string; clientId: string; contactId: string; cohortId: string; stage: number },
    account: EmailAccount,
    templateId: string,
  ): Promise<boolean> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: enr.contactId },
    });
    // Only an approved template is ever sent. One still awaiting review (or
    // rejected) holds the enrollment at this stage — it's retried next tick
    // rather than skipped, so no contact loses the touch once it's approved.
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id: templateId, status: TemplateStatus.APPROVED },
    });
    if (!contact || !template) return false;

    const data = {
      name: contact.firstName ?? '',
      first_name: contact.firstName ?? '',
      last_name: contact.lastName ?? '',
      company: contact.company ?? '',
      country: contact.country ?? '',
      email: contact.email,
      ...(contact.customFields as Record<string, unknown>),
    };
    const subject = renderTemplate(template.subject, data);
    const renderedBody = renderTemplate(template.bodyHtml, data);

    const message = await this.prisma.emailMessage.create({
      data: {
        tenantId: enr.tenantId,
        cohortId: enr.cohortId,
        contactId: contact.id,
        emailAccountId: account.id,
        direction: MessageDirection.OUTBOUND,
        subject,
        status: MessageStatus.QUEUED,
      },
    });

    const publicBase = this.config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:4000',
    );
    const html = instrumentHtml(renderedBody, publicBase, message.id);

    try {
      const result = await this.mailer.send({
        account,
        to: contact.email,
        subject,
        html,
        headers: { 'X-AEO-Message': message.id, 'X-AEO-Enrollment': enr.id },
      });
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.SENT,
          messageId: result.messageId,
          sentAt: new Date(),
        },
      });
      await this.prisma.emailEvent.create({
        data: { messageId: message.id, eventType: EventType.SENT },
      });
      return true;
    } catch (err) {
      // Permanent (hard) rejection → suppress now instead of re-emailing a dead address.
      if (this.bounce.isHardSmtpError(err)) {
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: MessageStatus.BOUNCED, error: String(err) },
        });
        await this.bounce.recordHardBounce(enr.tenantId, contact.email, { messageId: message.id, campaignId: null, reason: String((err as Error)?.message || err) });
        this.logger.warn(`Cohort send hard-bounced ${contact.email}: ${err}`);
        return false;
      }
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: MessageStatus.FAILED, error: String(err) },
      });
      this.logger.warn(`Cohort send failed to ${contact.email}: ${err}`);
      return false;
    }
  }

  private async assertClient(user: AuthUser, id: string): Promise<Client> {
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        // A client-portal user can only reach a profile they own.
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  /** Create (or reset) the client-portal login that owns a profile. */
  async setClientLogin(
    user: AuthUser,
    clientId: string,
    dto: { email: string; password?: string },
  ) {
    const client = await this.assertClient(user, clientId);
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Enter a login email.');
    const password = dto.password?.trim();
    const currentOwner = client.ownerUserId
      ? await this.prisma.user.findUnique({ where: { id: client.ownerUserId } })
      : null;

    // ── First-time login (no owner yet): create/link immediately (needs a password). ──
    if (!currentOwner) {
      if (!password || password.length < 6) throw new BadRequestException('Set a password (min 6 characters) to create the login.');
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      let owner = await this.prisma.user.findUnique({ where: { email } });
      if (owner) {
        owner = await this.prisma.user.update({ where: { id: owner.id }, data: { passwordHash, role: Role.CLIENT } });
      } else {
        owner = await this.prisma.user.create({
          data: { tenantId: user.tenantId, name: client.contactPerson || client.name, email, passwordHash, role: Role.CLIENT },
        });
      }
      await this.prisma.client.update({ where: { id: clientId }, data: { ownerUserId: owner.id } });
      await this.activity.log({ tenantId: user.tenantId, actorId: user.userId, action: 'SET_CLIENT_LOGIN', entityType: 'Client', entityId: clientId, after: { email, client: client.name } });
      return { ok: true, email, pending: false };
    }

    // ── Password reset applies immediately (if provided). ──
    if (password) {
      if (password.length < 6) throw new BadRequestException('Password must be at least 6 characters.');
      await this.prisma.user.update({ where: { id: currentOwner.id }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } });
    }

    // ── Email unchanged: nothing to gate. ──
    if (email === currentOwner.email.toLowerCase()) {
      return { ok: true, email, pending: false };
    }

    // ── Email CHANGE: gate it. The current login keeps working until the client
    // confirms via the emailed link OR an admin approves it in the queue. ──
    await this.gateLoginEmailChange(user, clientId, client.name, currentOwner.id, currentOwner.email, email);
    return { ok: true, email: currentOwner.email, pending: true, pendingEmail: email };
  }

  /**
   * Hold a client login-email change instead of applying it: stash pendingEmail + token,
   * email the confirmation link to the NEW address, and queue a CLIENT_LOGIN_EMAIL
   * approval as a fallback. Shared by setClientLogin and updateClientOwner so BOTH
   * admin paths are gated. The current login keeps working until confirmed/approved.
   */
  private async gateLoginEmailChange(user: AuthUser, clientId: string, clientName: string, ownerId: string, currentEmail: string, newEmail: string) {
    const taken = await this.prisma.user.findFirst({ where: { email: newEmail, id: { not: ownerId } } });
    if (taken) throw new BadRequestException('That email is already used by another account.');

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.user.update({
      where: { id: ownerId },
      data: { pendingEmail: newEmail, pendingEmailTokenHash: tokenHash, pendingEmailExpires: new Date(Date.now() + 48 * 3600 * 1000) },
    });

    const link = `${this.webUrlBase()}/verify-email-change?token=${token}`;
    this.logger.log(`[login-email-change] confirm link for ${newEmail}: ${link}`);
    try {
      const account = await this.tenantSystemMailbox(user.tenantId);
      if (account) {
        await this.mailer.send({
          account,
          to: newEmail,
          subject: 'Confirm your new GrapMe login email',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
              <h2 style="color:#0f766e">Confirm your new login email</h2>
              <p>Your account team set this address as the login email for your GrapMe portal (${clientName}).
                 Confirm it to activate — your current login keeps working until you do.</p>
              <p style="margin:22px 0">
                <a href="${link}" style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Confirm new login email</a>
              </p>
              <p style="color:#94a3b8;font-size:12px">This link expires in 48 hours. If you didn't expect this, you can ignore this email.</p>
            </div>`,
        });
      }
    } catch (e) {
      this.logger.warn(`login-email-change email to ${newEmail} failed: ${(e as Error).message}`);
    }

    const pending = await this.prisma.approval.count({
      where: { entityType: ApprovalEntity.CLIENT_LOGIN_EMAIL, entityId: ownerId, status: ApprovalStatus.PENDING },
    });
    if (!pending) {
      await this.approvals.submit({ tenantId: user.tenantId, entityType: ApprovalEntity.CLIENT_LOGIN_EMAIL, entityId: ownerId, submittedById: user.userId });
    }
    await this.activity.log({
      tenantId: user.tenantId, actorId: user.userId, action: 'REQUEST_CLIENT_LOGIN_EMAIL_CHANGE',
      entityType: 'Client', entityId: clientId, after: { from: currentEmail, to: newEmail, client: clientName },
    });
  }

  /** True once a client's validity window has elapsed. */
  private isValidityExpired(client: {
    validityDays: number | null;
    validityStartAt: Date | null;
  }): boolean {
    if (!client.validityDays || !client.validityStartAt) return false;
    const expiry =
      client.validityStartAt.getTime() + client.validityDays * 86_400_000;
    return expiry < Date.now();
  }

  /** A client only sends when it's active AND its validity hasn't expired. */
  private isClientActive(client: {
    status: string;
    validityDays: number | null;
    validityStartAt: Date | null;
  }): boolean {
    return (
      (client.status ?? 'active').toLowerCase() === 'active' &&
      !this.isValidityExpired(client)
    );
  }

  private webUrlBase(): string {
    return (
      this.config.get<string>('WEB_PUBLIC_URL') ||
      this.config.get<string>('CORS_ORIGIN') ||
      'http://localhost:3000'
    );
  }

  /** The mailbox used to send system/admin mail for a tenant, if any. */
  private async tenantSystemMailbox(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({
        where: { id: tenant.reportMailboxId },
      });
      if (acct) return acct;
    }
    return this.prisma.emailAccount.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Plan-expiry reminders: emails the client (CC admins) as the validity window
   * winds down — at ~10, 4 and 1 days out, and once on/after expiry. Each
   * milestone fires once; the stage marker (0..4) advances so a tick only ever
   * sends the most-urgent newly-crossed reminder. Reset when validity is renewed.
   */
  private async notifyValidityMilestones(): Promise<void> {
    const clients = await this.prisma.client.findMany({
      where: {
        validityDays: { not: null },
        validityStartAt: { not: null },
        validityNotifyStage: { lt: 4 },
      },
      include: { owner: { select: { email: true, name: true } } },
    });
    if (clients.length === 0) return;

    const now = Date.now();
    for (const c of clients) {
      const expiryMs =
        c.validityStartAt!.getTime() + c.validityDays! * 86_400_000;
      const daysLeft = Math.ceil((expiryMs - now) / 86_400_000);

      let target = c.validityNotifyStage;
      if (daysLeft <= 10) target = Math.max(target, 1);
      if (daysLeft <= 4) target = Math.max(target, 2);
      if (daysLeft <= 1) target = Math.max(target, 3);
      if (daysLeft <= 0) target = Math.max(target, 4);
      if (target <= c.validityNotifyStage) continue;

      try {
        await this.sendValidityReminder(c, daysLeft, target);
      } catch (err) {
        this.logger.warn(`Validity reminder failed for ${c.name}: ${err}`);
      }
      await this.prisma.client.update({
        where: { id: c.id },
        data: { validityNotifyStage: target },
      });
    }
  }

  private async sendValidityReminder(
    client: {
      id: string;
      name: string;
      tenantId: string;
      email: string | null;
      owner: { email: string | null; name: string | null } | null;
    },
    daysLeft: number,
    stage: number,
  ): Promise<void> {
    const to = client.owner?.email || client.email;
    if (!to) return;
    const account = await this.tenantSystemMailbox(client.tenantId);
    if (!account) return;

    const admins = await this.prisma.user.findMany({
      where: { tenantId: client.tenantId, role: Role.SUPER_ADMIN, status: 'ACTIVE' },
      select: { email: true },
    });
    const cc = admins.map((a) => a.email).filter(Boolean).join(', ') || undefined;

    const expired = stage >= 4 || daysLeft <= 0;
    const headline = expired
      ? `Your plan for ${client.name} has expired`
      : `Your plan for ${client.name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    const body = expired
      ? 'Your outreach has been paused. Please contact your account manager to renew and resume sending.'
      : 'Please contact your account manager to renew before it lapses, so your outreach keeps running without interruption.';

    await this.mailer.send({
      account,
      to,
      cc,
      subject: headline,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:${expired ? '#b91c1c' : '#0f766e'}">${headline}</h2>
          <p>${body}</p>
          <p style="margin:20px 0">
            <a href="${this.webUrlBase()}/client"
               style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
              Open your portal
            </a>
          </p>
          <p style="color:#94a3b8;font-size:12px">GrapMe · GVC Framework</p>
        </div>`,
    });
    this.logger.log(
      `Validity reminder (stage ${stage}, ${daysLeft}d) sent to ${to} for ${client.name}`,
    );
  }

  /**
   * Monthly campaign-data reminder. Within the first week of each month (on a
   * per-client jittered day so sends spread out), email each EMAIL-enabled client's
   * salesperson + operation contacts that next month's batch of ~80–100 buyers/
   * suppliers is due to be added to the email campaign. Guarded to fire at most
   * once per client per month via lastCampaignReminderAt.
   */
  private async notifyCampaignDataDue(): Promise<void> {
    const now = new Date();
    // Same 8–9am IST slot as the other staff mail. This runs on the 60-second
    // tick, so without the gate it fired at whatever hour the target day began.
    if (!inStaffMailHour(now)) return;
    const dayOfMonth = istNow(now).dayOfMonth;
    if (dayOfMonth > 7) return; // only during the first week of the month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;

    const clients = await this.prisma.client.findMany({
      where: {
        emailEnabled: true,
        status: { equals: 'active', mode: 'insensitive' },
        OR: [{ lastCampaignReminderAt: null }, { lastCampaignReminderAt: { lt: monthStart } }],
      },
      select: {
        id: true,
        name: true,
        tenantId: true,
        operationContacts: true,
        salesPerson: { select: { id: true, email: true, name: true } },
      },
    });
    if (clients.length === 0) return;

    for (const c of clients) {
      // Jitter: a deterministic target day (1..7) within the first week; only fire
      // on/after that day so reminders don't all go out on the 1st.
      const targetDay = 1 + (hashInt(c.id + monthKey) % 7);
      if (dayOfMonth < targetDay) continue;
      // And its own minute inside the slot, so a day's clients don't all leave
      // at 08:00 together. Deterministic, so a restart can't re-roll it.
      if (istNow(now).minute < hashInt(c.id + monthKey + 'min') % 55) continue;

      const opsEmails = extractOpsEmails(c.operationContacts);
      const recipients = [...new Set([c.salesPerson?.email, ...opsEmails].filter(Boolean) as string[])];
      if (recipients.length === 0) continue; // nobody to notify yet — retry later in the week

      try {
        await this.sendCampaignDataReminder(c.tenantId, c.name, recipients);
        if (c.salesPerson?.id) {
          await this.prisma.notification.create({
            data: {
              userId: c.salesPerson.id,
              type: 'campaign-data',
              title: `New campaign data due — ${c.name}`,
              body: `Please add this month's 80–100 buyers/suppliers to ${c.name}'s email campaign.`,
              link: `/sales-clients/${c.id}`,
            },
          });
        }
        await this.prisma.client.update({ where: { id: c.id }, data: { lastCampaignReminderAt: now } });
        this.logger.log(`Campaign-data reminder sent for ${c.name} to ${recipients.join(', ')}`);
      } catch (err) {
        this.logger.warn(`Campaign-data reminder failed for ${c.name}: ${err}`);
      }
    }
  }

  /** Fire the campaign-data reminder right now (admin test) — no date window, no
   *  monthly stamp. Returns the recipients so the UI can confirm delivery targets. */
  async testCampaignReminder(user: AuthUser, clientId: string): Promise<{ sent: string[] }> {
    this.assertAdmin(user);
    const c = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      select: { id: true, name: true, tenantId: true, operationContacts: true, salesPerson: { select: { email: true } } },
    });
    if (!c) throw new NotFoundException('Client not found');
    const recipients = [...new Set([c.salesPerson?.email, ...extractOpsEmails(c.operationContacts)].filter(Boolean) as string[])];
    if (recipients.length === 0) {
      throw new BadRequestException('No recipients — assign a salesperson or add an operation contact first.');
    }
    await this.sendCampaignDataReminder(c.tenantId, c.name, recipients, true);
    return { sent: recipients };
  }

  private async sendCampaignDataReminder(tenantId: string, clientName: string, to: string[], strict = false): Promise<void> {
    const account = await this.tenantSystemMailbox(tenantId);
    if (!account) {
      if (strict) throw new BadRequestException('No sending mailbox is configured for this workspace.');
      return;
    }
    const subject = `Action needed: new campaign data due for ${clientName}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#0f766e">New campaign data due — ${escapeHtml(clientName)}</h2>
        <p>It's the start of a new month. Please add this month's fresh batch of
        <strong>80–100 buyers/suppliers</strong> to the email campaign for
        <strong>${escapeHtml(clientName)}</strong> so the outreach continues without a gap.</p>
        <p style="color:#64748b;font-size:13px">Each subscription covers up to 1,000 buyers/suppliers globally, topped up ~80–100 per month.</p>
        <p style="margin:20px 0">
          <a href="${this.webUrlBase()}/login"
             style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
            Open GrapMe
          </a>
        </p>
        <p style="color:#94a3b8;font-size:12px">GrapMe · GVC Framework</p>
      </div>`;
    for (const addr of to) {
      try {
        await this.mailer.send({ account, to: addr, subject, html });
      } catch (err) {
        this.logger.warn(`Campaign reminder to ${addr} failed: ${err}`);
        if (strict) throw new BadRequestException(`Send failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /**
   * Auto-enforcement: any active client whose validity has expired is flipped to
   * inactive and its running cohorts paused. Run at the top of each engine tick.
   */
  private async enforceClientValidity(): Promise<void> {
    const candidates = await this.prisma.client.findMany({
      where: {
        status: 'active',
        validityDays: { not: null },
        validityStartAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        validityDays: true,
        validityStartAt: true,
      },
    });
    for (const c of candidates) {
      if (!this.isValidityExpired(c)) continue;
      await this.prisma.client.update({
        where: { id: c.id },
        data: { status: 'inactive' },
      });
      await this.prisma.cohort.updateMany({
        where: { clientId: c.id, status: 'RUNNING' },
        data: { status: 'PAUSED' },
      });
      // LinkedIn channel: pause running campaigns and deactivate seats too.
      await this.suspendLinkedIn(c.id);
      this.logger.log(
        `Validity expired for "${c.name}" → set inactive, running cohorts + LinkedIn campaigns paused`,
      );
    }
  }

  /** Pause a client's LinkedIn campaigns when it's suspended (validity expiry / deactivation). */
  private async suspendLinkedIn(clientId: string): Promise<void> {
    try {
      await this.liCampaigns.pauseAllForClient(clientId);
    } catch (err) {
      this.logger.warn(`LinkedIn suspend failed for client ${clientId}: ${err}`);
    }
  }

  /** Resume a client's LinkedIn campaigns when it's reactivated / renewed. */
  private async resumeLinkedIn(clientId: string): Promise<void> {
    try {
      await this.liCampaigns.resumeAllForClient(clientId);
    } catch (err) {
      this.logger.warn(`LinkedIn resume failed for client ${clientId}: ${err}`);
    }
  }

  /**
   * Admin: activate / deactivate a client. Deactivating pauses its running
   * cohorts (they never send until reactivated); activating resumes paused
   * cohorts, renewing an already-expired validity window so it can run again.
   */
  async setClientStatus(user: AuthUser, clientId: string, active: boolean) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    if (active) {
      const renew = this.isValidityExpired(client);
      await this.prisma.client.update({
        where: { id: clientId },
        data: {
          status: 'active',
          ...(renew ? { validityStartAt: new Date(), validityNotifyStage: 0 } : {}),
        },
      });
      await this.resumeClientWork(clientId);
    } else {
      await this.prisma.client.update({
        where: { id: clientId },
        data: { status: 'inactive' },
      });
      await this.prisma.cohort.updateMany({
        where: { clientId, status: 'RUNNING' },
        data: { status: 'PAUSED' },
      });
      await this.suspendLinkedIn(clientId);
    }
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: active ? 'ACTIVATE_CLIENT' : 'DEACTIVATE_CLIENT',
      entityType: 'Client',
      entityId: clientId,
      after: { client: client.name, status: active ? 'active' : 'inactive' },
    });
    return { ok: true, status: active ? 'active' : 'inactive' };
  }

  /** Resume what a suspension paused: the client's cohorts and its LinkedIn campaigns. */
  private async resumeClientWork(clientId: string): Promise<void> {
    await this.prisma.cohort.updateMany({
      where: { clientId, status: 'PAUSED' },
      data: { status: 'RUNNING' },
    });
    await this.resumeLinkedIn(clientId);
  }

  /**
   * Renew a client's subscription with a new invoice.
   *
   * The invoice being replaced is kept on the subscription history (backfilled there if
   * the client predates it), the new invoice starts a fresh validity window, and the
   * client is marked Renewed. Everything else about the client — contacts, channels,
   * email and LinkedIn settings, mailboxes, cohorts, campaigns — is left exactly as it is.
   * Work is only resumed if the lapse had suspended it.
   */
  async renewClient(user: AuthUser, clientId: string, dto: RenewClientDto) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);

    const invoiceNo = joinCsvList(splitCsvList(dto.invoiceNo));
    if (!invoiceNo) throw new BadRequestException('Enter the new invoice number.');
    const invoiceDate = new Date(dto.invoiceDate);
    if (isNaN(invoiceDate.getTime())) throw new BadRequestException('Enter a valid invoice date.');
    // A renewal is a new invoice. Re-entering one already on the subscription would
    // bump the renewal count and restart the window with nothing actually bought.
    const current = new Set(splitCsvList(client.invoiceNo).map((n) => n.toLowerCase()));
    if (splitCsvList(invoiceNo).every((n) => current.has(n.toLowerCase()))) {
      throw new BadRequestException('That invoice number is already on this subscription. A renewal needs a new invoice.');
    }
    const plan = (dto.plan ?? '').trim() || client.plan;
    const validityDays = Math.floor(Number(dto.validityDays ?? client.validityDays ?? 0));
    if (!validityDays || validityDays < 1) {
      throw new BadRequestException('Enter the validity (days) for the renewed subscription.');
    }

    const actor = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    const actorName = actor?.name || actor?.email || 'Someone';

    await this.subscriptions.snapshotCurrent(user.tenantId, client);

    const wasSuspended = (client.status ?? 'active').toLowerCase() !== 'active';
    const now = new Date();
    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        invoiceNo,
        invoiceDate,
        plan,
        validityDays,
        validityStartAt: now,
        validityNotifyStage: 0, // fresh window → expiry reminders start over
        status: 'active',
        renewalCount: { increment: 1 },
        lastRenewedAt: now,
      },
    });
    await this.subscriptions.record(user.tenantId, clientId, {
      plan, validityDays, source: 'renewal', recordedById: user.userId, recordedByName: actorName,
    });

    if (wasSuspended) await this.resumeClientWork(clientId);

    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'RENEW_CLIENT',
      entityType: 'Client',
      entityId: clientId,
      before: { invoiceNo: client.invoiceNo, invoiceDate: client.invoiceDate, plan: client.plan, validityDays: client.validityDays, status: client.status },
      after: { invoiceNo, invoiceDate, plan, validityDays, status: 'active' },
    });
    return updated;
  }

  /** Admin: set a client's plan validity window (days). Resets the start date. */
  async setClientValidity(user: AuthUser, clientId: string, days: number | null) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    const validityDays = days && days > 0 ? Math.floor(days) : null;
    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        validityDays,
        validityStartAt: validityDays ? new Date() : null,
        validityNotifyStage: 0, // fresh window → reminders start over
      },
      select: { id: true, validityDays: true, validityStartAt: true },
    });
    // Log a new subscription period for the history (closes any open one early).
    if (validityDays) {
      await this.subscriptions.record(user.tenantId, clientId, { plan: client.plan, validityDays, source: 'admin' });
    }
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'SET_CLIENT_VALIDITY',
      entityType: 'Client',
      entityId: clientId,
      after: { validityDays, client: client.name },
    });
    return updated;
  }

  /**
   * Add days to a client's CURRENT validity window without restarting it —
   * e.g. a 30-day plan with 20 days left, +10 → a 40-day plan with 30 days
   * left, same start date. (Setting a new validity restarts from today.)
   * Only for a window that is still running; an expired plan is renewed by
   * setting a fresh validity.
   */
  async extendClientValidity(user: AuthUser, clientId: string, days: number) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    const add = Math.floor(Number(days));
    if (!Number.isFinite(add) || add < 1 || add > 3650) {
      throw new BadRequestException('Enter a number of days between 1 and 3650.');
    }
    if (!client.validityDays || !client.validityStartAt) {
      throw new BadRequestException('This client has no validity window to extend. Set a validity first.');
    }
    const now = Date.now();
    const oldExpiry = client.validityStartAt.getTime() + client.validityDays * 86_400_000;
    if (oldExpiry <= now) {
      throw new BadRequestException('This plan has already expired. Set a new validity to renew it.');
    }

    const validityDays = client.validityDays + add;
    const expiresAt = new Date(oldExpiry + add * 86_400_000);
    const daysLeft = Math.ceil((expiresAt.getTime() - now) / 86_400_000);
    // Re-arm expiry reminders against the new end date, using the same
    // thresholds as notifyValidityMilestones: milestones still genuinely
    // crossed stay sent (nothing re-fires now), the ones the extension pushed
    // back will send again as the new expiry approaches.
    const stillCrossed = daysLeft <= 1 ? 3 : daysLeft <= 4 ? 2 : daysLeft <= 10 ? 1 : 0;

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        validityDays,
        validityNotifyStage: Math.min(client.validityNotifyStage, stillCrossed),
      },
      select: { id: true, validityDays: true, validityStartAt: true },
    });
    await this.subscriptions.extendOpen(clientId, add, expiresAt);
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'EXTEND_CLIENT_VALIDITY',
      entityType: 'Client',
      entityId: clientId,
      before: { validityDays: client.validityDays, expiresAt: new Date(oldExpiry) },
      after: { validityDays, expiresAt, addedDays: add, client: client.name },
    });
    return { ...updated, addedDays: add, daysLeft, expiresAt };
  }

  /**
   * Force-expire a client's active plan right now: move the validity window into the
   * past (so it reads Expired but keeps the plan/day count) and close the open
   * subscription period as CANCELLED. Outreach halts immediately (the engine gates on
   * validity). Re-set a validity to renew.
   */
  async forceExpireSubscription(user: AuthUser, clientId: string) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    if (!client.validityDays || client.validityDays <= 0) {
      throw new BadRequestException('This client has no active plan window to expire.');
    }
    const now = new Date();
    await this.prisma.client.update({
      where: { id: clientId },
      data: { validityStartAt: new Date(now.getTime() - client.validityDays * 86_400_000), validityNotifyStage: 0 },
    });
    await this.prisma.subscriptionPeriod.updateMany({
      where: { clientId, endedReason: null, endAt: { gt: now } },
      data: { endAt: now, endedReason: 'CANCELLED' },
    });
    await this.activity.log({
      tenantId: user.tenantId, actorId: user.userId, action: 'FORCE_EXPIRE_SUBSCRIPTION',
      entityType: 'Client', entityId: clientId, after: { client: client.name },
    });
    return { ok: true };
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
  }

  /** Default password handed to a client who never received a reset email. */
  private static readonly DEFAULT_CLIENT_PASSWORD = 'grapout@123';

  /** Admin: reset a client login to the shared default password. */
  async resetClientDefaultPassword(user: AuthUser, clientId: string) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    if (!client.ownerUserId) {
      throw new BadRequestException('Set a client login first.');
    }
    const passwordHash = await argon2.hash(
      ProgramsService.DEFAULT_CLIENT_PASSWORD,
      { type: argon2.argon2id },
    );
    await this.prisma.user.update({
      where: { id: client.ownerUserId },
      data: { passwordHash, emailVerified: true, status: 'ACTIVE' },
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'RESET_CLIENT_DEFAULT_PASSWORD',
      entityType: 'Client',
      entityId: clientId,
      after: { client: client.name },
    });
    return { ok: true, password: ProgramsService.DEFAULT_CLIENT_PASSWORD };
  }

  /** Admin: edit the client login's identity (name/email/phone). */
  async updateClientOwner(
    user: AuthUser,
    clientId: string,
    dto: { name?: string; email?: string; mobile?: string },
  ) {
    this.assertAdmin(user);
    const client = await this.assertClient(user, clientId);
    if (!client.ownerUserId) {
      throw new BadRequestException('Set a client login first.');
    }
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: client.ownerUserId }, select: { email: true } });
    const email = dto.email?.trim().toLowerCase();

    // Name/phone are plain identity fields → apply immediately. But the login EMAIL is
    // a credential: if it's actually changing, gate it (client link OR admin approval)
    // exactly like the login form — never change the login email instantly.
    const owner = await this.prisma.user.update({
      where: { id: client.ownerUserId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.mobile !== undefined ? { contactMobile: dto.mobile } : {}),
      },
      select: { id: true, name: true, email: true, contactMobile: true },
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'UPDATE_CLIENT_OWNER',
      entityType: 'Client',
      entityId: clientId,
      after: { name: owner.name },
    });

    if (email && email !== current.email.toLowerCase()) {
      await this.gateLoginEmailChange(user, clientId, client.name, client.ownerUserId, current.email, email);
      return { ...owner, pending: true, pendingEmail: email };
    }
    return { ...owner, pending: false };
  }

  /** Profiles owned by a client-portal user (for the client panel switcher). */
  async myClientProfiles(user: AuthUser) {
    if (user.role !== Role.CLIENT) return [];
    return this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true, name: true, serviceType: true, plan: true, validityDays: true, validityStartAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}

// ── helpers for the monthly campaign-data reminder ──
function hashInt(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Trim submitted operation contacts and drop blank rows, so "mandatory" means a real address. */
function cleanOperationContacts(list?: { name?: string; email: string }[]): { name: string; email: string }[] {
  return (list ?? [])
    .map((o) => ({ name: (o.name ?? '').trim(), email: (o.email ?? '').trim() }))
    .filter((o) => o.email);
}

function extractOpsEmails(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((x) => (x && typeof x === 'object' && 'email' in x ? String((x as { email?: unknown }).email ?? '').trim() : ''))
    .filter((e) => /.+@.+\..+/.test(e));
}

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
