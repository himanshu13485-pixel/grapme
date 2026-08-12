import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SetupGroup, SetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AddClientStepDto, AddTemplateStepDto, UpdateSetupStepDto, UpdateTemplateStepDto } from './dto/reporting.dto';

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
  ) {}

  private isAdmin(user: AuthUser) {
    return user.role === Role.SUPER_ADMIN || user.role === Role.SUB_ADMIN;
  }
  private assertAdmin(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Admins only');
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

  async removeTemplateStep(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const row = await this.prisma.setupStepTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Step not found');
    // Soft-remove: deactivate so it stops seeding new clients, but keep existing history.
    await this.prisma.setupStepTemplate.update({ where: { id }, data: { active: false } });
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
    // The Account Setup % is one-time onboarding only — monthly ops steps are excluded.
    const core = steps.filter((s) => s.group !== 'MONTHLY');
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
    this.assertAdmin(user);
    const step = await this.prisma.clientSetupStep.findFirst({ where: { id: stepId, tenantId: user.tenantId } });
    if (!step) throw new NotFoundException('Step not found');
    if (step.templateKey) throw new BadRequestException('Default steps can only be removed from the default list, not per client.');
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
          where: { clientId: { in: clientIds }, group: { not: 'MONTHLY' } }, // monthly ops steps don't count toward the %
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
        id: true, name: true, invoiceNo: true, plan: true, status: true,
        emailEnabled: true, linkedInEnabled: true,
        salesPerson: { select: { id: true, name: true } },
      },
    });
    const progress = await this.progressForClients(user, clients);
    return clients.map((c) => ({
      ...c,
      progress: progress.get(c.id) ?? { total: 0, finished: 0, started: 0, percent: 0 },
    }));
  }

  /** { clientId: percent } for the Clients-Workspace box bar. */
  async progressMap(user: AuthUser) {
    if (!this.isAdmin(user) && user.role !== Role.SALES) return {};
    const clients = await this.prisma.client.findMany({
      where: this.clientScopeWhere(user),
      select: { id: true, emailEnabled: true, linkedInEnabled: true },
    });
    const progress = await this.progressForClients(user, clients);
    const out: Record<string, { percent: number; finished: number; total: number }> = {};
    for (const [id, p] of progress) out[id] = { percent: p.percent, finished: p.finished, total: p.total };
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

  /**
   * Reminder sweep for the monthly "Email arrangement" ops steps. Safe to run often
   * (idempotent via lastReminderAt): for each due, not-finished, assigned monthly step —
   *  - first nudge once the service month has begun,
   *  - then re-nudge every 2 days while NOT_STARTED, every 3 days while STARTED,
   * emailing + WhatsApping the assignee. Internal only (never shown to the client).
   */
  async runSetupReminders(): Promise<{ sent: number }> {
    const now = new Date();
    const steps = await this.prisma.clientSetupStep.findMany({
      where: { group: 'MONTHLY', status: { not: 'FINISHED' }, assigneeUserId: { not: null } },
      select: {
        id: true, label: true, monthIndex: true, status: true, lastReminderAt: true, assigneeUserId: true,
        client: { select: { name: true, status: true, termStartedAt: true } },
      },
    });
    let sent = 0;
    for (const s of steps) {
      if (!s.assigneeUserId || !s.monthIndex) continue;
      if ((s.client.status ?? 'active').toLowerCase() !== 'active') continue;
      // The service month this arrangement covers must have started.
      const dueStart = addMonths(s.client.termStartedAt ?? now, s.monthIndex - 1);
      if (now.getTime() < dueStart.getTime()) continue;
      const intervalMs = (s.status === 'STARTED' ? 3 : 2) * 86_400_000;
      const due = !s.lastReminderAt || now.getTime() - s.lastReminderAt.getTime() >= intervalMs;
      if (!due) continue;

      const verb = s.status === 'STARTED' ? 'is in progress but not finished' : 'has not been started';
      await this.notify.notify(s.assigneeUserId, {
        type: 'reporting',
        title: `Email arrangement pending — ${s.client.name}`,
        body: `The 80–100 email arrangement for ${s.client.name} (Month ${s.monthIndex}) ${verb}. Please action it.`,
        emailHtml: `<p>The <strong>80–100 email arrangement</strong> for <strong>${escapeHtml(s.client.name)}</strong> (Month ${s.monthIndex}) ${verb}.</p><p>Please add next month's buyers/suppliers and set up the arrangement.</p>`,
        whatsappText: `GrapMe: 80–100 email arrangement pending for ${s.client.name} (Month ${s.monthIndex}). ${s.status === 'STARTED' ? 'Started — please finish.' : 'Please start.'}`,
        link: '/reporting',
      }).catch((e) => this.logger.warn(`setup reminder failed for step ${s.id}: ${e}`));
      await this.prisma.clientSetupStep.update({ where: { id: s.id }, data: { lastReminderAt: now } });
      sent += 1;
    }
    if (sent) this.logger.log(`Setup reminders: sent ${sent} monthly-arrangement nudge(s)`);
    return { sent };
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
