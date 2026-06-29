import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  EmailAccount,
  EnrollmentStatus,
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { renderTemplate } from '../templates/templates.service';
import { instrumentHtml } from '../sending/tracking.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
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

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
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
  ) {}

  // ── Clients ───────────────────────────────────────────────
  createClient(user: AuthUser, dto: CreateClientDto) {
    return this.prisma.client.create({
      data: { tenantId: user.tenantId, ...dto },
    });
  }

  listClients(user: AuthUser) {
    return this.prisma.client.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { mailboxes: true, cohorts: true, enrollments: true } },
      },
    });
  }

  async getClient(user: AuthUser, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
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
    await this.assertClient(user, id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  // ── Mailbox group ─────────────────────────────────────────
  async assignMailbox(user: AuthUser, clientId: string, dto: AssignMailboxDto) {
    await this.assertClient(user, clientId);
    const mailbox = await this.prisma.emailAccount.findFirst({
      where: { id: dto.mailboxId, tenantId: user.tenantId },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
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
      await this.prisma.sequenceStep.create({
        data: {
          clientId: scope.clientId,
          cohortId: scope.cohortId,
          stageOrder: step.stageOrder,
          templateId: step.templateId,
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
    return this.createAndEnroll(client, fresh, label, dto.monthIndex, startDate);
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
    const totalSpanDays =
      client.batchWindowDays + client.followUpCount * client.stageIntervalDays;

    return cohorts.map((co) => {
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
        estEndAt: addBusinessDays(co.startDate, totalSpanDays),
        total,
        active: byStatus['ACTIVE'] ?? 0,
        due: dueMap.get(co.id) ?? 0,
        replied: byStatus['REPLIED'] ?? 0,
        completed: byStatus['COMPLETED'] ?? 0,
        stopped: byStatus['STOPPED'] ?? 0,
        sent,
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

    const allSteps = await this.prisma.sequenceStep.findMany({
      where: { client: { tenantId: user.tenantId } },
      select: { clientId: true, cohortId: true, stageOrder: true, waitDays: true },
      orderBy: { stageOrder: 'asc' },
    });
    const defaultByClient = new Map<string, typeof allSteps>();
    const byCohort = new Map<string, typeof allSteps>();
    for (const s of allSteps) {
      const map = s.cohortId ? byCohort : defaultByClient;
      const key = s.cohortId ?? s.clientId;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }

    const today = new Date();
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
      if (!client) continue;
      const steps = byCohort.get(co.id)?.length
        ? byCohort.get(co.id)!
        : (defaultByClient.get(co.clientId) ?? []);
      const maxStage = steps.reduce(
        (m, s) => Math.max(m, s.stageOrder),
        client.followUpCount,
      );
      let cursor = new Date(co.startDate);
      for (let stage = 0; stage <= maxStage; stage++) {
        const wait =
          steps.find((s) => s.stageOrder === stage)?.waitDays ??
          (stage === 0 ? 0 : client.stageIntervalDays);
        if (stage > 0) cursor = addBusinessDays(cursor, wait);
        const estStart = new Date(cursor);
        const estEnd = addBusinessDays(
          estStart,
          Math.max(0, client.batchWindowDays - 1),
        );
        if (today > estEnd) continue; // already done
        rows.push({
          clientName: client.name,
          cohortLabel: co.label,
          monthIndex: co.monthIndex,
          stage: stage === 0 ? 'Initial' : `Follow-up ${stage}`,
          estStart,
          estEnd,
          state: today >= estStart ? 'current' : 'upcoming',
        });
      }
    }
    rows.sort((a, b) => a.estStart.getTime() - b.estStart.getTime());
    return rows;
  }

  // ── Cohort lifecycle: pause / resume / stop ───────────────
  async pauseCohort(user: AuthUser, cohortId: string) {
    await this.assertCohort(user, cohortId);
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'PAUSED' },
    });
    return { ok: true };
  }

  async resumeCohort(user: AuthUser, cohortId: string) {
    await this.assertCohort(user, cohortId);
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'RUNNING' },
    });
    return { ok: true };
  }

  /** Stop permanently: halt the cohort and end every still-active contact. */
  async stopCohort(user: AuthUser, cohortId: string) {
    await this.assertCohort(user, cohortId);
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { status: 'STOPPED', endedAt: new Date() },
    });
    await this.prisma.enrollment.updateMany({
      where: { cohortId, status: EnrollmentStatus.ACTIVE },
      data: { status: EnrollmentStatus.STOPPED },
    });
    return { ok: true };
  }

  /** Delete a cohort and all its enrollments (cascade). */
  async deleteCohort(user: AuthUser, cohortId: string) {
    await this.assertCohort(user, cohortId);
    await this.prisma.cohort.delete({ where: { id: cohortId } });
    return { ok: true };
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
      if (client.weekdaysOnly && isWeekend(now)) {
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

      let rot = 0;
      for (const enr of enrollments) {
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
        const templateId =
          cohortSteps.find((s) => s.stageOrder === enr.stage)?.templateId ?? null;
        if (!templateId) {
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

        const ok = await this.sendOne(enr, mailbox, templateId);
        if (ok) {
          sent++;
          sentToday.set(mailbox.id, (sentToday.get(mailbox.id) ?? 0) + 1);
          lastSentMs.set(mailbox.id, nowMs);
          // Cap by THIS cohort's own sequence length (not the client default).
          const maxStage = cohortSteps.reduce(
            (m, s) => Math.max(m, s.stageOrder),
            0,
          );
          const nextStage = enr.stage + 1;
          if (nextStage > maxStage) {
            await this.prisma.enrollment.update({
              where: { id: enr.id },
              data: { status: EnrollmentStatus.COMPLETED, lastSentAt: now },
            });
          } else {
            // Gap until the next stage = that stage's own waitDays (falls back
            // to the client's default), jittered ± a few days to look human.
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
            await this.prisma.enrollment.update({
              where: { id: enr.id },
              data: { stage: nextStage, lastSentAt: now, nextTouchAt },
            });
          }
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
      where: { id, tenantId: user.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }
}
