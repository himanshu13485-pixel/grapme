import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, Role, SetupGroup, SetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { QUEUE_ENROLL, JOB_SETUP_NOTIFY } from '../queue/queue.constants';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AddClientStepDto, AddTemplateStepDto, UpdateSetupStepDto, UpdateTemplateStepDto } from './dto/reporting.dto';
import { inStaffMailHour, staffMailJitterMs } from '../common/office-hours';

/** A single staggered reminder job: one channel to one owner about one client's pending work. */
export interface SetupNotifyJob {
  userId: string;
  channel: 'email' | 'whatsapp' | 'inApp';
  title: string;
  body: string;
  emailHtml?: string;
  whatsappText?: string;
  link?: string;
}
const REMINDER_GAP_MS = 60_000; // ≥60s between email↔whatsapp and between recipients

/** The managed default checklist seeded per tenant. Order is global across groups. */
const DEFAULT_TEMPLATE: { key: string; label: string; group: SetupGroup }[] = [
  { key: 'grapme_registration', label: 'GrapMe Registration', group: 'GENERAL' },
  { key: 'workspace_add', label: 'Workspace Add', group: 'GENERAL' },
  { key: 'email_connection', label: 'Email Connection', group: 'EMAIL' },
  { key: 'mailbox_setup', label: 'Mailbox Setup', group: 'EMAIL' },
  { key: 'contact_list', label: 'Contact List', group: 'EMAIL' },
  { key: 'templates', label: 'Templates', group: 'EMAIL' },
  { key: 'sequence', label: 'Sequence', group: 'EMAIL' },
  { key: 'cohorts_setup', label: 'Cohorts Setup', group: 'EMAIL' },
  { key: 'email_final_setup', label: 'Final Setup (Email)', group: 'EMAIL' },
  { key: 'linkedin_setup', label: 'LinkedIn Setup', group: 'LINKEDIN' },
  { key: 'linkedin_connection', label: 'LinkedIn Connection', group: 'LINKEDIN' },
  { key: 'campaign_setup', label: 'Campaign Setup', group: 'LINKEDIN' },
  { key: 'schedule', label: 'Schedule', group: 'LINKEDIN' },
  { key: 'linkedin_final_setup', label: 'Final Setup (LinkedIn)', group: 'LINKEDIN' },
];

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    @Optional() @InjectQueue(QUEUE_ENROLL) private readonly queue?: Queue,
  ) {}

  private isAdmin(user: AuthUser) {
    return user.role === Role.SUPER_ADMIN || user.role === Role.SUB_ADMIN;
  }
  private assertAdmin(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Admins only');
  }
  /** Delete access: super admins always; sub-admins only with the explicit
   *  delete flag ("Full access" alone does not grant deletion). */
  private async assertCanDelete(user: AuthUser) {
    if (user.role === Role.SUPER_ADMIN) return;
    if (user.role === Role.SUB_ADMIN) {
      const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { canDelete: true } });
      if (u?.canDelete) return;
    }
    throw new ForbiddenException('You do not have delete access');
  }

  /** Clients this user may see: admins → all; salesperson → their assigned clients. */
  private clientScopeWhere(user: AuthUser): Prisma.ClientWhereInput {
    if (this.isAdmin(user)) return { tenantId: user.tenantId };
    if (user.role === Role.SALES) return { tenantId: user.tenantId, salesPersonId: user.userId };
    return { tenantId: user.tenantId, id: '__none__' }; // no access for anyone else
  }

  private async loadScopedClient(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, ...this.clientScopeWhere(user) },
      select: { id: true, name: true, tenantId: true, emailEnabled: true, linkedInEnabled: true, salesPersonId: true, serviceMonths: true, setupNotifiedAt: true },
    });
    if (!client) throw new NotFoundException('Client not found (or outside your scope)');
    return client;
  }

  private actorName(user: AuthUser) {
    return this.prisma.user
      .findUnique({ where: { id: user.userId }, select: { name: true, email: true } })
      .then((u) => u?.name || u?.email || 'Someone');
  }

  // ── managed default checklist (template) ─────────────────────────────
  /** Seed the tenant's default checklist the first time it's needed. */
  async ensureTemplate(tenantId: string) {
    const count = await this.prisma.setupStepTemplate.count({ where: { tenantId } });
    if (count > 0) return;
    await this.prisma.setupStepTemplate.createMany({
      data: DEFAULT_TEMPLATE.map((t, i) => ({ tenantId, key: t.key, label: t.label, group: t.group, order: i })),
      skipDuplicates: true,
    });
  }

  async listTemplate(user: AuthUser) {
    this.assertAdmin(user);
    await this.ensureTemplate(user.tenantId);
    return this.prisma.setupStepTemplate.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addTemplateStep(user: AuthUser, dto: AddTemplateStepDto) {
    this.assertAdmin(user);
    await this.ensureTemplate(user.tenantId);
    const group = dto.group ?? 'GENERAL';
    const max = await this.prisma.setupStepTemplate.aggregate({ where: { tenantId: user.tenantId }, _max: { order: true } });
    const key = `custom_${slugify(dto.label)}_${Date.now().toString(36)}`;
    return this.prisma.setupStepTemplate.create({
      data: { tenantId: user.tenantId, key, label: dto.label.trim(), group, order: (max._max.order ?? 0) + 1, active: true },
    });
  }

  async updateTemplateStep(user: AuthUser, id: string, dto: UpdateTemplateStepDto) {
    this.assertAdmin(user);
    const row = await this.prisma.setupStepTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Step not found');
    const updated = await this.prisma.setupStepTemplate.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.group !== undefined ? { group: dto.group } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
      },
    });
    // Keep already-instantiated client steps' labels/groups in sync when renamed/regrouped.
    if (dto.label !== undefined || dto.group !== undefined) {
      await this.prisma.clientSetupStep.updateMany({
        where: { tenantId: user.tenantId, templateKey: row.key },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.group !== undefined ? { group: dto.group } : {}),
        },
      });
    }
    return updated;
  }

  /** Reorder a default step within its group (swap order with the adjacent step). */
  async moveTemplateStep(user: AuthUser, id: string, dir: 'up' | 'down') {
    this.assertAdmin(user);
    const row = await this.prisma.setupStepTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Step not found');
    const neighbor = await this.prisma.setupStepTemplate.findFirst({
      where: {
        tenantId: user.tenantId, group: row.group,
        order: dir === 'up' ? { lt: row.order } : { gt: row.order },
      },
      orderBy: { order: dir === 'up' ? 'desc' : 'asc' },
    });
    if (!neighbor) return { ok: true }; // already at the edge
    await this.prisma.$transaction([
      this.prisma.setupStepTemplate.update({ where: { id: row.id }, data: { order: neighbor.order } }),
      this.prisma.setupStepTemplate.update({ where: { id: neighbor.id }, data: { order: row.order } }),
    ]);
    // Mirror the new order onto already-instantiated client steps.
    await this.prisma.clientSetupStep.updateMany({ where: { tenantId: user.tenantId, templateKey: row.key }, data: { order: neighbor.order } });
    await this.prisma.clientSetupStep.updateMany({ where: { tenantId: user.tenantId, templateKey: neighbor.key }, data: { order: row.order } });
    return { ok: true };
  }

  /** Hard-delete a default step and every client instance of it (needs delete access). */
  async removeTemplateStep(user: AuthUser, id: string) {
    await this.assertCanDelete(user);
    const row = await this.prisma.setupStepTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Step not found');
    await this.prisma.$transaction([
      this.prisma.clientSetupStep.deleteMany({ where: { tenantId: user.tenantId, templateKey: row.key } }),
      this.prisma.setupStepTemplate.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // ── per-client checklist ─────────────────────────────────────────────
  private applicableGroups(client: { emailEnabled: boolean; linkedInEnabled: boolean }): SetupGroup[] {
    const groups: SetupGroup[] = ['GENERAL'];
    if (client.emailEnabled) groups.push('EMAIL');
    if (client.linkedInEnabled) groups.push('LINKEDIN');
    return groups;
  }

  /** Ensure a client has an instance of every applicable active template step, plus the
   *  monthly "Email arrangement" steps for its months of service. */
  private async syncClientSteps(client: { id: string; tenantId: string; emailEnabled: boolean; linkedInEnabled: boolean; serviceMonths?: number }) {
    await this.ensureTemplate(client.tenantId);
    const groups = this.applicableGroups(client);
    const template = await this.prisma.setupStepTemplate.findMany({
      where: { tenantId: client.tenantId, active: true, group: { in: groups } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const existing = await this.prisma.clientSetupStep.findMany({
      where: { clientId: client.id, templateKey: { not: null } },
      select: { templateKey: true },
    });
    const have = new Set(existing.map((e) => e.templateKey));
    const toCreate = template
      .filter((t) => !have.has(t.key))
      .map((t) => ({ tenantId: client.tenantId, clientId: client.id, templateKey: t.key, label: t.label, group: t.group, order: t.order, monthIndex: null as number | null }));

    // Monthly "Email arrangement" steps: one per bought month (only if email is on).
    const months = Math.max(0, Math.min(12, client.serviceMonths ?? 0));
    if (months > 0 && client.emailEnabled) {
      for (let m = 1; m <= months; m++) {
        const key = `month_${m}`;
        if (have.has(key)) continue;
        toCreate.push({ tenantId: client.tenantId, clientId: client.id, templateKey: key, label: `Email arrangement — Month ${m} (${ordinal(m)})`, group: 'MONTHLY', order: 1000 + m, monthIndex: m });
      }
    }

    if (toCreate.length) {
      await this.prisma.clientSetupStep.createMany({ data: toCreate, skipDuplicates: true });
    }
  }

  /** Full checklist + progress for one client (creating any missing steps first). */
  async clientDetail(user: AuthUser, clientId: string) {
    const client = await this.loadScopedClient(user, clientId);
    await this.syncClientSteps(client);
    const steps = await this.prisma.clientSetupStep.findMany({
      where: { clientId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { events: { orderBy: { at: 'desc' }, take: 10 } },
    });
    // The Account Setup % is one-time onboarding only — monthly + hidden steps are excluded.
    const core = steps.filter((s) => s.group !== 'MONTHLY' && !s.hidden);
    const total = core.length;
    const finished = core.filter((s) => s.status === 'FINISHED').length;
    const started = core.filter((s) => s.status === 'STARTED').length;
    return {
      client: { id: client.id, name: client.name, emailEnabled: client.emailEnabled, linkedInEnabled: client.linkedInEnabled, serviceMonths: client.serviceMonths, setupNotifiedAt: client.setupNotifiedAt },
      progress: { total, finished, started, percent: total ? Math.round((finished / total) * 100) : 0 },
      steps,
    };
  }

  /** Admin sets the client's months of service (0–12) → (re)generates the monthly steps. */
  async setServiceMonths(user: AuthUser, clientId: string, months: number) {
    this.assertAdmin(user);
    const client = await this.loadScopedClient(user, clientId);
    const m = Math.max(0, Math.min(12, Math.round(months || 0)));
    await this.prisma.client.update({ where: { id: client.id }, data: { serviceMonths: m } });
    // Add any newly-needed monthly steps; if reduced, cancel the now-extra ones (keep history off).
    await this.syncClientSteps({ ...client, serviceMonths: m });
    if (m >= 0) {
      await this.prisma.clientSetupStep.deleteMany({ where: { clientId: client.id, group: 'MONTHLY', monthIndex: { gt: m } } });
    }
    return { ok: true, serviceMonths: m };
  }

  /** First-save / on-demand: notify each assigned owner about their pending steps here. */
  async notifyAssignees(user: AuthUser, clientId: string) {
    this.assertAdmin(user);
    const client = await this.loadScopedClient(user, clientId);
    await this.syncClientSteps(client);
    const steps = await this.prisma.clientSetupStep.findMany({
      where: { clientId, assigneeUserId: { not: null }, status: { not: 'FINISHED' } },
      select: { label: true, assigneeUserId: true },
    });
    // Group pending steps by assignee, then send each a single summary alert.
    const byUser = new Map<string, string[]>();
    for (const s of steps) {
      if (!s.assigneeUserId) continue;
      const list = byUser.get(s.assigneeUserId) ?? [];
      list.push(s.label);
      byUser.set(s.assigneeUserId, list);
    }
    let notified = 0;
    for (const [userId, labels] of byUser) {
      const lines = labels.map((l) => `• ${l}`).join('\n');
      await this.notify.notify(userId, {
        type: 'reporting',
        title: `Setup tasks assigned to you — ${client.name}`,
        body: `You have ${labels.length} pending setup task(s) for ${client.name}:\n${lines}`,
        emailHtml: `<p>You have <strong>${labels.length}</strong> pending setup task(s) for <strong>${escapeHtml(client.name)}</strong>:</p><ul>${labels.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
        whatsappText: `GrapMe: ${labels.length} setup task(s) pending for ${client.name}. Please start when you can.`,
        link: '/reporting',
      }).catch((e) => this.logger.warn(`notifyAssignees failed for ${userId}: ${e}`));
      notified += 1;
    }
    await this.prisma.client.update({ where: { id: client.id }, data: { setupNotifiedAt: new Date() } });
    return { ok: true, notified };
  }

  async addCustomStep(user: AuthUser, clientId: string, dto: AddClientStepDto) {
    this.assertAdmin(user);
    const client = await this.loadScopedClient(user, clientId);
    const group = dto.group ?? 'GENERAL';
    const max = await this.prisma.clientSetupStep.aggregate({ where: { clientId }, _max: { order: true } });
    return this.prisma.clientSetupStep.create({
      data: {
        tenantId: client.tenantId, clientId, templateKey: null,
        label: dto.label.trim(), group, order: (max._max.order ?? 0) + 1,
      },
    });
  }

  async deleteStep(user: AuthUser, stepId: string) {
    await this.assertCanDelete(user);
    const step = await this.prisma.clientSetupStep.findFirst({ where: { id: stepId, tenantId: user.tenantId } });
    if (!step) throw new NotFoundException('Step not found');
    // Default-list (and monthly) steps are managed globally / by months-of-service, and a
    // re-sync would recreate them — so only per-client CUSTOM extras can be deleted here.
    if (step.templateKey) throw new BadRequestException('This step is managed in "Default steps" or by Months of service — remove it there.');
    await this.prisma.clientSetupStep.delete({ where: { id: stepId } });
    return { ok: true };
  }

  async updateStep(user: AuthUser, stepId: string, dto: UpdateSetupStepDto) {
    const step = await this.prisma.clientSetupStep.findFirst({
      where: { id: stepId, tenantId: user.tenantId },
      select: { id: true, clientId: true, status: true, startedAt: true, client: { select: { salesPersonId: true } } },
    });
    if (!step) throw new NotFoundException('Step not found');
    // Salespersons may only touch steps for their own clients; admins anywhere.
    const isAssignedSales = user.role === Role.SALES && step.client.salesPersonId === user.userId;
    if (!this.isAdmin(user) && !isAssignedSales) throw new ForbiddenException('Not allowed to update this step');

    const data: Prisma.ClientSetupStepUpdateInput = {};
    const name = await this.actorName(user);

    // Rename (admins only) — a per-client label override.
    if (dto.label !== undefined) {
      if (!this.isAdmin(user)) throw new ForbiddenException('Only admins can rename a step');
      data.label = dto.label.trim();
      data.updatedByName = name;
    }

    // Hide/unhide for this client (admins only) — sticks across re-syncs.
    if (dto.hidden !== undefined) {
      if (!this.isAdmin(user)) throw new ForbiddenException('Only admins can hide a step');
      data.hidden = !!dto.hidden;
    }

    // Status transition (records timestamps + an audit event).
    if (dto.status && dto.status !== step.status) {
      data.status = dto.status;
      data.updatedByName = name;
      if (dto.status === 'FINISHED') {
        data.finishedAt = new Date();
        if (!step.startedAt) data.startedAt = new Date();
      } else if (dto.status === 'STARTED') {
        data.finishedAt = null;
        if (!step.startedAt) data.startedAt = new Date();
      } else {
        data.startedAt = null;
        data.finishedAt = null;
      }
    }

    // Assignee change: '' clears; a user id assigns that staff member (admins only).
    if (dto.assigneeUserId !== undefined) {
      if (!this.isAdmin(user)) throw new ForbiddenException('Only admins can change the assignee');
      if (dto.assigneeUserId === '') {
        data.assigneeUserId = null; data.assigneeName = null; data.assigneeEmail = null; data.assigneeRole = null;
      } else {
        const u = await this.prisma.user.findFirst({
          where: { id: dto.assigneeUserId, tenantId: user.tenantId, role: { not: Role.CLIENT } },
          select: { id: true, name: true, email: true, role: true },
        });
        if (!u) throw new BadRequestException('Assignee not found');
        data.assigneeUserId = u.id; data.assigneeName = u.name || u.email; data.assigneeEmail = u.email; data.assigneeRole = u.role;
      }
      if (!data.updatedByName) data.updatedByName = name;
    }

    if (Object.keys(data).length === 0) return this.prisma.clientSetupStep.findUnique({ where: { id: stepId } });

    const updated = await this.prisma.clientSetupStep.update({ where: { id: stepId }, data });
    if (dto.status && dto.status !== step.status) {
      await this.prisma.clientSetupEvent.create({
        data: { stepId, status: dto.status, actorUserId: user.userId, actorName: name },
      });
    }
    return updated;
  }

  // ── list + progress (Reporting page + Workspace Box bar) ─────────────
  /** Per-client progress across the scoped clients, without forcing a sync-write. */
  private async progressForClients(
    user: AuthUser,
    clients: { id: string; emailEnabled: boolean; linkedInEnabled: boolean }[],
  ): Promise<Map<string, { total: number; finished: number; started: number; percent: number }>> {
    await this.ensureTemplate(user.tenantId);
    const template = await this.prisma.setupStepTemplate.findMany({
      where: { tenantId: user.tenantId, active: true },
      select: { group: true },
    });
    const tplByGroup = { GENERAL: 0, EMAIL: 0, LINKEDIN: 0 } as Record<SetupGroup, number>;
    template.forEach((t) => { tplByGroup[t.group] += 1; });

    const clientIds = clients.map((c) => c.id);
    const steps = clientIds.length
      ? await this.prisma.clientSetupStep.findMany({
          where: { clientId: { in: clientIds }, group: { not: 'MONTHLY' }, hidden: false }, // monthly + hidden steps don't count toward the %
          select: { clientId: true, templateKey: true, status: true },
        })
      : [];
    // Per client: finished/started counts, and custom-step count (denominator extras).
    const agg = new Map<string, { finished: number; started: number; custom: number }>();
    for (const s of steps) {
      const a = agg.get(s.clientId) ?? { finished: 0, started: 0, custom: 0 };
      if (s.status === 'FINISHED') a.finished += 1;
      else if (s.status === 'STARTED') a.started += 1;
      if (!s.templateKey) a.custom += 1;
      agg.set(s.clientId, a);
    }

    const out = new Map<string, { total: number; finished: number; started: number; percent: number }>();
    for (const c of clients) {
      const applicable = tplByGroup.GENERAL + (c.emailEnabled ? tplByGroup.EMAIL : 0) + (c.linkedInEnabled ? tplByGroup.LINKEDIN : 0);
      const a = agg.get(c.id) ?? { finished: 0, started: 0, custom: 0 };
      const total = applicable + a.custom;
      out.set(c.id, { total, finished: a.finished, started: a.started, percent: total ? Math.round((a.finished / total) * 100) : 0 });
    }
    return out;
  }

  /** Per-client monthly-arrangement statuses (for the little month squares). */
  private async monthsForClients(clientIds: string[]): Promise<Map<string, { i: number; status: SetupStatus }[]>> {
    const out = new Map<string, { i: number; status: SetupStatus }[]>();
    if (!clientIds.length) return out;
    const rows = await this.prisma.clientSetupStep.findMany({
      where: { clientId: { in: clientIds }, group: 'MONTHLY', hidden: false },
      select: { clientId: true, monthIndex: true, status: true },
      orderBy: { monthIndex: 'asc' },
    });
    for (const r of rows) {
      if (r.monthIndex == null) continue;
      const list = out.get(r.clientId) ?? [];
      list.push({ i: r.monthIndex, status: r.status });
      out.set(r.clientId, list);
    }
    return out;
  }

  async listClients(user: AuthUser, search?: string) {
    if (!this.isAdmin(user) && user.role !== Role.SALES) throw new ForbiddenException('No access');
    const q = search?.trim();
    const where: Prisma.ClientWhereInput = {
      ...this.clientScopeWhere(user),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { invoiceNo: { contains: q, mode: 'insensitive' } }, { productCategory: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, invoiceNo: true, invoiceDate: true, plan: true, status: true,
        productCategory: true,
        emailEnabled: true, linkedInEnabled: true, createdAt: true,
        setupStartedAt: true, setupFinishedAt: true,
        salesPerson: { select: { id: true, name: true } },
      },
    });
    const progress = await this.progressForClients(user, clients);
    const months = await this.monthsForClients(clients.map((c) => c.id));
    const stopwatch = await this.syncStopwatch(clients, progress);
    return clients.map((c) => ({
      ...c,
      progress: progress.get(c.id) ?? { total: 0, finished: 0, started: 0, percent: 0 },
      months: months.get(c.id) ?? [],
      ...stopwatch.get(c.id)!,
    }));
  }

  /**
   * Keeps the onboarding stopwatch in sync and returns the effective values:
   *  - startedAt: stamped once, lazily — existing/running boxes start ticking
   *    "from now" the first time they're viewed after this shipped.
   *  - finishedAt: stamped when the checklist first reaches 100%, cleared again
   *    if a step is later re-opened (so it always reflects the current state).
   */
  private async syncStopwatch(
    clients: { id: string; setupStartedAt: Date | null; setupFinishedAt: Date | null }[],
    progress: Map<string, { percent: number }>,
  ): Promise<Map<string, { setupStartedAt: Date; setupFinishedAt: Date | null }>> {
    const now = new Date();
    const out = new Map<string, { setupStartedAt: Date; setupFinishedAt: Date | null }>();
    for (const c of clients) {
      const percent = progress.get(c.id)?.percent ?? 0;
      let startedAt = c.setupStartedAt;
      let finishedAt = c.setupFinishedAt;
      const patch: { setupStartedAt?: Date; setupFinishedAt?: Date | null } = {};
      if (!startedAt) { startedAt = now; patch.setupStartedAt = now; }
      if (percent >= 100 && !finishedAt) { finishedAt = now; patch.setupFinishedAt = now; }
      else if (percent < 100 && finishedAt) { finishedAt = null; patch.setupFinishedAt = null; }
      if (Object.keys(patch).length) {
        await this.prisma.client.update({ where: { id: c.id }, data: patch }).catch(() => undefined);
      }
      out.set(c.id, { setupStartedAt: startedAt, setupFinishedAt: finishedAt });
    }
    return out;
  }

  /** { clientId: {percent, months[]} } for the Clients-Workspace box bar + month squares. */
  async progressMap(user: AuthUser) {
    if (!this.isAdmin(user) && user.role !== Role.SALES) return {};
    const clients = await this.prisma.client.findMany({
      where: this.clientScopeWhere(user),
      select: { id: true, emailEnabled: true, linkedInEnabled: true },
    });
    const progress = await this.progressForClients(user, clients);
    const months = await this.monthsForClients(clients.map((c) => c.id));
    const out: Record<string, { percent: number; finished: number; total: number; months: { i: number; status: SetupStatus }[] }> = {};
    for (const [id, p] of progress) out[id] = { percent: p.percent, finished: p.finished, total: p.total, months: months.get(id) ?? [] };
    return out;
  }

  /** A client-portal user's own setup progress (per owned workspace) — dashboard box only. */
  async myProgress(user: AuthUser) {
    const clients = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true, name: true, emailEnabled: true, linkedInEnabled: true },
    });
    if (clients.length === 0) return { workspaces: [], overall: { total: 0, finished: 0, percent: 0 } };
    const progress = await this.progressForClients(user, clients);
    const workspaces = clients.map((c) => {
      const p = progress.get(c.id) ?? { total: 0, finished: 0, started: 0, percent: 0 };
      return { id: c.id, name: c.name, total: p.total, finished: p.finished, started: p.started, percent: p.percent };
    });
    const total = workspaces.reduce((s, w) => s + w.total, 0);
    const finished = workspaces.reduce((s, w) => s + w.finished, 0);
    return { workspaces, overall: { total, finished, percent: total ? Math.round((finished / total) * 100) : 0 } };
  }

  // ── settings (global on/off for setup reminders) ─────────────────────
  async getSettings(user: AuthUser) {
    if (!this.isAdmin(user) && user.role !== Role.SALES) throw new ForbiddenException('No access');
    const t = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { setupRemindersEnabled: true } });
    return { remindersEnabled: t?.setupRemindersEnabled ?? true };
  }
  async setRemindersEnabled(user: AuthUser, enabled: boolean) {
    this.assertAdmin(user);
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { setupRemindersEnabled: !!enabled } });
    return { ok: true, remindersEnabled: !!enabled };
  }

  /** Called by the reminder queue: send ONE channel of ONE reminder (staggered). */
  async sendReminderChannel(job: SetupNotifyJob) {
    await this.notify.notify(
      job.userId,
      { type: 'reporting', title: job.title, body: job.body, emailHtml: job.emailHtml, whatsappText: job.whatsappText, link: job.link },
      { inApp: job.channel === 'inApp', email: job.channel === 'email', whatsapp: job.channel === 'whatsapp' },
    ).catch((e) => this.logger.warn(`reminder ${job.channel} to ${job.userId} failed: ${e}`));
  }

  /**
   * Daily reminder sweep. When the tenant has reminders ON: nudge each assigned owner about
   * their still-pending setup steps —
   *   • General / Email / LinkedIn steps: once per day until Finished,
   *   • MONTHLY "email arrangement": from the service month's start, every 2 days (NOT_STARTED)
   *     / 3 days (STARTED).
   * Email + WhatsApp for each alert are staggered ≥60s apart, and consecutive recipients are
   * spaced too, via delayed queue jobs. Internal only (never shown to the client).
   */
  async runSetupReminders(): Promise<{ sent: number }> {
    const now = new Date();
    // Staff reminders belong in the 8–9am IST slot. The sweep ticks hourly, so
    // exactly one tick a day falls inside it; every other tick returns here.
    // Before this, a 20-hour cadence meant the mail walked 4 hours earlier each
    // day and eventually arrived in the middle of the night.
    if (!inStaffMailHour(now)) return { sent: 0 };
    const enabledTenants = new Set(
      (await this.prisma.tenant.findMany({ where: { setupRemindersEnabled: true }, select: { id: true } })).map((t) => t.id),
    );
    if (enabledTenants.size === 0) return { sent: 0 };

    const steps = await this.prisma.clientSetupStep.findMany({
      where: { status: { not: 'FINISHED' }, assigneeUserId: { not: null }, tenantId: { in: [...enabledTenants] } },
      select: {
        id: true, label: true, group: true, order: true, monthIndex: true, status: true, lastReminderAt: true,
        assigneeUserId: true, clientId: true,
        client: { select: { name: true, status: true, termStartedAt: true } },
      },
      orderBy: [{ group: 'asc' }, { order: 'asc' }],
    });

    // One message per owner per client, not per step. Two people carry most of the
    // checklist, so a 16-step client used to mean a dozen separate mails a day into the
    // same two inboxes — enough noise that the reminders stopped being read.
    //
    // Due-ness is decided for the GROUP, not the step: once any of a person's steps on a
    // client is due, the mail lists everything they currently owe on it. Judging each step
    // separately would only merge steps that happened to fall due in the same hourly
    // sweep, so a step assigned a few hours after the others would drift permanently out
    // of step and split back into a second daily mail.
    const groups = new Map<string, { items: DueStep[]; fire: boolean }>();
    for (const s of steps) {
      if (!s.assigneeUserId) continue;
      if ((s.client.status ?? 'active').toLowerCase() !== 'active') continue;

      // Has this step arrived at all, and how long between nudges once it has?
      let intervalMs: number;
      if (s.group === 'MONTHLY') {
        if (!s.monthIndex) continue;
        const dueStart = addMonths(s.client.termStartedAt ?? now, s.monthIndex - 1);
        if (now.getTime() < dueStart.getTime()) continue; // month not reached — not pending yet
        intervalMs = (s.status === 'STARTED' ? 3 : 2) * 86_400_000;
      } else {
        intervalMs = 20 * 3_600_000; // once per day
      }
      const ripe = !s.lastReminderAt || now.getTime() - s.lastReminderAt.getTime() >= intervalMs;

      const key = `${s.assigneeUserId}::${s.clientId}`;
      const entry = groups.get(key) ?? { items: [], fire: false };
      entry.items.push({
        stepId: s.id, userId: s.assigneeUserId, clientId: s.clientId, clientName: s.client.name,
        label: s.label, monthly: s.group === 'MONTHLY', started: s.status === 'STARTED',
      });
      entry.fire ||= ripe;
      groups.set(key, entry);
    }

    for (const [key, g] of groups) if (!g.fire) groups.delete(key);
    if (groups.size === 0) return { sent: 0 };

    // Stamp every step in a firing group, so they stay in lockstep for the next sweep.
    const stamped = [...groups.values()].flatMap((g) => g.items.map((i) => i.stepId));
    await this.prisma.clientSetupStep.updateMany({ where: { id: { in: stamped } }, data: { lastReminderAt: now } });

    // Dispatch: bell immediately; email + WhatsApp go out on a per-recipient
    // random delay inside the 8–9am slot. A fixed ladder was predictable to the
    // minute and, past ~30 recipients, walked the tail out of the slot entirely.
    for (const g of groups.values()) {
      const job = buildDigest(g.items);
      const base = staffMailJitterMs();
      await this.enqueueReminder({ ...job, channel: 'inApp' }, 0);
      await this.enqueueReminder({ ...job, channel: 'email' }, base);
      await this.enqueueReminder({ ...job, channel: 'whatsapp' }, base + REMINDER_GAP_MS);
    }
    this.logger.log(`Setup reminders: ${stamped.length} pending step(s) → ${groups.size} message(s) (staggered)`);
    return { sent: groups.size };
  }

  /** Queue a single staggered channel send; if the queue is off (no Redis), send inline. */
  private async enqueueReminder(job: SetupNotifyJob, delayMs: number) {
    if (this.queue) {
      await this.queue.add(JOB_SETUP_NOTIFY, job, { delay: Math.max(0, delayMs), removeOnComplete: 1000, removeOnFail: 500 }).catch(() => this.sendReminderChannel(job));
    } else {
      await this.sendReminderChannel(job);
    }
  }

  /** Staff members assignable as a step's "concern person". */
  async teamMembers(user: AuthUser) {
    if (!this.isAdmin(user) && user.role !== Role.SALES) throw new ForbiddenException('No access');
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, role: { not: Role.CLIENT }, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email, role: u.role }));
  }
}

/** One pending step, flattened for grouping into a per-client digest. */
interface DueStep {
  stepId: string;
  userId: string;
  clientId: string;
  clientName: string;
  label: string;
  monthly: boolean;
  started: boolean;
}

/** "is in progress but not finished" / "has not been started". */
function statusPhrase(started: boolean): string {
  return started ? 'is in progress but not finished' : 'has not been started';
}

/**
 * One reminder covering every step this person owes on this client today.
 *
 * A single pending step keeps the original wording — the digest shape only kicks in when
 * there is actually more than one thing to say, so nothing reads oddly for the common case.
 */
function buildDigest(items: DueStep[]): Omit<SetupNotifyJob, 'channel'> {
  const { clientName, userId } = items[0];
  const link = '/reporting';
  const monthlyNote = items.some((i) => i.monthly)
    ? "<p>For the monthly email arrangement, please add next month's buyers/suppliers and set it up.</p>"
    : '';

  if (items.length === 1) {
    const only = items[0];
    const phrase = statusPhrase(only.started);
    return {
      userId,
      title: `Setup task pending — ${clientName}`,
      body: `"${only.label}" for ${clientName} ${phrase}. Please update it in Reporting.`,
      emailHtml:
        `<p>Your setup task <strong>"${escapeHtml(only.label)}"</strong> for <strong>${escapeHtml(clientName)}</strong> ${phrase}.</p>`
        + (monthlyNote || '<p>Please move it forward (Not started → Started → Finished) in Reporting.</p>'),
      whatsappText: `GrapMe: setup task "${only.label}" for ${clientName} ${phrase}. Please update.`,
      link,
    };
  }

  const notStarted = items.filter((i) => !i.started).length;
  const inProgress = items.length - notStarted;
  const summary = [
    notStarted ? `${notStarted} not started` : '',
    inProgress ? `${inProgress} in progress` : '',
  ].filter(Boolean).join(', ');

  const rows = items
    .map((i) => `<li><strong>${escapeHtml(i.label)}</strong> — ${statusPhrase(i.started)}</li>`)
    .join('');

  return {
    userId,
    title: `${items.length} setup tasks pending — ${clientName}`,
    body: `You have ${items.length} pending setup tasks for ${clientName} (${summary}). Please update them in Reporting.`,
    emailHtml:
      `<p>You have <strong>${items.length} pending setup tasks</strong> for <strong>${escapeHtml(clientName)}</strong> (${summary}):</p>`
      + `<ul>${rows}</ul>`
      + monthlyNote
      + '<p>Please move each one forward (Not started → Started → Finished) in Reporting.</p>',
    whatsappText:
      `GrapMe: ${items.length} setup tasks pending for ${clientName} —\n`
      + items.map((i) => `• ${i.label} (${i.started ? 'in progress' : 'not started'})`).join('\n'),
    link,
  };
}

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'step';
}

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
function ordinal(n: number): string { return ORDINALS[n] ?? `${n}th`; }

/** First day of the month that is `n` months after `d`. */
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0, 0);
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
