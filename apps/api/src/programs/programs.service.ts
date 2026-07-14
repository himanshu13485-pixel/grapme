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
  Prisma,
  EmailAccount,
  EnrollmentStatus,
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
  Role,
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
import { LiCampaignsService } from '../linkedin/campaigns/li-campaigns.service';
import { LinkedInSubscriptionService } from '../linkedin/subscription/linkedin-subscription.service';
import { BounceService } from '../bounce/bounce.service';
import {
  AssignMailboxDto,
  CreateClientDto,
  CreateCohortDto,
  SequenceStepDto,
  SetSequenceDto,
  UpdateClientDto,
} from './dto/programs.dto';

/** Adds `n` business days (Mon–Fri) to a date; snaps weekends forward. */
function addBusinessDays(base: Date, n: number): Date {
  const d = new Date(base);
  // Snap the starting point to a weekday first.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}


function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sets a random clock time within the client's send window (human-like). */
function withSendTime(date: Date, startHour: number, endHour: number): Date {
  const d = new Date(date);
  const hi = Math.max(startHour + 1, endHour);
  d.setHours(randomInt(startHour, hi - 1), randomInt(0, 59), randomInt(0, 59), 0);
  return d;
}

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
    const { linkedin, validityDays, ...clientData } = dto;
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
      data: { tenantId: user.tenantId, ...clientData, ...validity, ...ownerData },
    });

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

  private readonly clientListInclude = {
    _count: { select: { mailboxes: true, cohorts: true, enrollments: true, contacts: true } },
    owner: { select: { id: true, name: true, email: true, contactMobile: true, emailVerified: true, pendingEmail: true } },
  } as const;

  listClients(user: AuthUser) {
    return this.prisma.client.findMany({
      where: {
        tenantId: user.tenantId,
        // Client-portal users only see the profiles they own.
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.clientListInclude,
    });
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
      linkedInEnabled?: string;
      channel?: string;
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
    const status = (query.status ?? '').toLowerCase();
    if (status === 'active' || status === 'inactive') {
      and.push({ status: { equals: status, mode: 'insensitive' } });
    }
    if (query.plan) and.push({ plan: query.plan });
    if (query.linkedInEnabled === 'true') and.push({ linkedInEnabled: true });
    // Channel filter — matches the card's label logic (email is on unless explicitly off).
    switch ((query.channel ?? '').toUpperCase()) {
      case 'EMAIL': and.push({ linkedInEnabled: false }); break;
      case 'LINKEDIN': and.push({ linkedInEnabled: true, emailEnabled: false }); break;
      case 'BOTH': and.push({ linkedInEnabled: true, emailEnabled: { not: false } }); break;
    }
    if (query.invoice) and.push({ invoiceNo: ci(query.invoice) });
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
        const [emailSent, emailOpens, liByStatus] = await Promise.all([
          this.prisma.emailMessage.count({
            where: { emailAccount: { clientId: c.id }, direction: MessageDirection.OUTBOUND, status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] } },
          }),
          this.prisma.emailEvent.count({
            where: { eventType: EventType.OPEN, message: { emailAccount: { clientId: c.id } } },
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
        return { id: c.id, emailSent, emailOpens, liLeads, liConnected, liInvites };
      }),
    );
    const statsById = new Map(stats.map((s) => [s.id, s]));
    const itemsWithStats = items.map((c) => {
      const s = statsById.get(c.id);
      return {
        ...c,
        stats: {
          emailSent: s?.emailSent ?? 0,
          emailOpens: s?.emailOpens ?? 0,
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

  async updateClient(user: AuthUser, id: string, dto: UpdateClientDto) {
    const before = await this.assertClient(user, id);
    // Validity is stored with a start date; changing the window (re)starts the clock.
    const { validityDays, ...rest } = dto;
    const data: Prisma.ClientUpdateInput = { ...rest };
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
    await this.prisma.sequenceStep.deleteMany({
      where: scope.cohortId
        ? { cohortId: scope.cohortId }
        : { clientId: scope.clientId, cohortId: null },
    });
    // Same month as previous → ~10-day in-month gap; each extra month → ~21 days.
    const sorted = [...steps].sort((a, b) => a.stageOrder - b.stageOrder);
    let prevMonth = 1;
    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      const month =
        i === 0 ? 1 : Math.max(prevMonth, step.monthOffset ?? prevMonth);
      const waitDays =
        i === 0 ? 0 : month === prevMonth ? 10 : (month - prevMonth) * 21;
      // Per-mailbox variants: keep empties so a variant maps to its mailbox slot,
      // but drop trailing blanks. templateId mirrors the first for back-compat.
      const rawVariants = (step.templateIds ?? []).map((t) => (t ?? '').trim());
      while (rawVariants.length && !rawVariants[rawVariants.length - 1]) {
        rawVariants.pop();
      }
      const variants =
        rawVariants.length || !step.templateId ? rawVariants : [step.templateId];
      await this.prisma.sequenceStep.create({
        data: {
          clientId: scope.clientId,
          cohortId: scope.cohortId,
          stageOrder: step.stageOrder,
          templateId: variants.find((v) => v) ?? null,
          templateIds: variants,
          monthOffset: month,
          waitDays,
        },
      });
      prevMonth = month;
    }
  }

  /** Edit the client's DEFAULT sequence (template new cohorts start from). */
  async setSequence(user: AuthUser, clientId: string, dto: SetSequenceDto) {
    await this.assertClient(user, clientId);
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
    );
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'CREATE_COHORT',
      entityType: 'Cohort',
      entityId: cohort.cohortId,
      after: { label: label ?? null, contacts: fresh.length, client: client.name },
    });
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
    return this.createFromSource(client, listId);
  }

  private async createFromSource(client: Client, listId: string) {
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
    return this.createAndEnroll(client, fresh, list?.name);
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
  ) {
    const monthIndex =
      monthIndexArg ??
      (await this.prisma.cohort.count({ where: { clientId: client.id } })) + 1;

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
        label: label ?? `Month ${monthIndex}`,
        monthIndex,
        startDate: start,
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
    return { cohortId: cohort.id, enrolled: contactIds.length, monthIndex };
  }

  listCohorts(user: AuthUser, clientId: string) {
    return this.prisma.cohort.findMany({
      where: { clientId, tenantId: user.tenantId },
      orderBy: { monthIndex: 'asc' },
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
  async cohortStats(user: AuthUser, clientId: string) {
    const client = await this.assertClient(user, clientId);
    const cohorts = await this.prisma.cohort.findMany({
      where: { clientId, tenantId: user.tenantId },
      orderBy: { monthIndex: 'asc' },
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
      where: { cohortId: { in: cohortIds }, direction: MessageDirection.OUTBOUND },
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
        message: { cohortId: { in: cohortIds } },
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
    cohort: { id: string; label: string; monthIndex: number },
  ) {
    return this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action,
      entityType: 'Cohort',
      entityId: cohort.id,
      after: { label: cohort.label, month: cohort.monthIndex },
    });
  }

  async pauseCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'PAUSED' },
    });
    await this.logCohort(user, 'PAUSE_COHORT', cohort);
    return { ok: true };
  }

  async resumeCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.assertCohort(user, cohortId);
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
    await this.prisma.cohort.delete({ where: { id: cohortId } });
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
    await this.assertCohort(user, cohortId);
    await this.prisma.enrollment.updateMany({
      where: { cohortId, status: EnrollmentStatus.ACTIVE },
      data: { nextTouchAt: new Date() },
    });
    return this.runDueNow();
  }

  private async assertCohort(user: AuthUser, cohortId: string) {
    const cohort = await this.prisma.cohort.findFirst({
      where: { id: cohortId, tenantId: user.tenantId },
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
    const template = await this.prisma.emailTemplate.findUnique({
      where: { id: templateId },
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
        await this.bounce.recordHardBounce(enr.tenantId, contact.email, { messageId: message.id, campaignId: null });
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
    const taken = await this.prisma.user.findFirst({ where: { email, id: { not: currentOwner.id } } });
    if (taken) throw new BadRequestException('That email is already used by another account.');

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.user.update({
      where: { id: currentOwner.id },
      data: { pendingEmail: email, pendingEmailTokenHash: tokenHash, pendingEmailExpires: new Date(Date.now() + 48 * 3600 * 1000) },
    });

    // Confirmation link to the NEW email.
    const link = `${this.webUrlBase()}/verify-email-change?token=${token}`;
    this.logger.log(`[login-email-change] confirm link for ${email}: ${link}`);
    try {
      const account = await this.tenantSystemMailbox(user.tenantId);
      if (account) {
        await this.mailer.send({
          account,
          to: email,
          subject: 'Confirm your new GrapMe login email',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
              <h2 style="color:#0f766e">Confirm your new login email</h2>
              <p>Your account team set this address as the login email for your GrapMe portal (${client.name}).
                 Confirm it to activate — your current login keeps working until you do.</p>
              <p style="margin:22px 0">
                <a href="${link}" style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Confirm new login email</a>
              </p>
              <p style="color:#94a3b8;font-size:12px">This link expires in 48 hours. If you didn't expect this, you can ignore this email.</p>
            </div>`,
        });
      }
    } catch (e) {
      this.logger.warn(`login-email-change email to ${email} failed: ${(e as Error).message}`);
    }

    // Fallback approval so an admin can apply the change if the email never arrives.
    const pending = await this.prisma.approval.count({
      where: { entityType: ApprovalEntity.CLIENT_LOGIN_EMAIL, entityId: currentOwner.id, status: ApprovalStatus.PENDING },
    });
    if (!pending) {
      await this.approvals.submit({ tenantId: user.tenantId, entityType: ApprovalEntity.CLIENT_LOGIN_EMAIL, entityId: currentOwner.id, submittedById: user.userId });
    }
    await this.activity.log({
      tenantId: user.tenantId, actorId: user.userId, action: 'REQUEST_CLIENT_LOGIN_EMAIL_CHANGE',
      entityType: 'Client', entityId: clientId, after: { from: currentOwner.email, to: email, client: client.name },
    });
    return { ok: true, email: currentOwner.email, pending: true, pendingEmail: email };
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
      await this.prisma.cohort.updateMany({
        where: { clientId, status: 'PAUSED' },
        data: { status: 'RUNNING' },
      });
      await this.resumeLinkedIn(clientId);
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
    const email = dto.email?.toLowerCase();
    if (email) {
      const clash = await this.prisma.user.findFirst({
        where: { email, id: { not: client.ownerUserId } },
      });
      if (clash) throw new BadRequestException('That email is already in use.');
    }
    const owner = await this.prisma.user.update({
      where: { id: client.ownerUserId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(email ? { email } : {}),
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
      after: { name: owner.name, email: owner.email },
    });
    return owner;
  }

  /** Profiles owned by a client-portal user (for the client panel switcher). */
  async myClientProfiles(user: AuthUser) {
    if (user.role !== Role.CLIENT) return [];
    return this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true, name: true, serviceType: true, plan: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
