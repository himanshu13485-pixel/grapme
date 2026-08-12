import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SetupGroup, SetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
      select: { id: true, name: true, tenantId: true, emailEnabled: true, linkedInEnabled: true, salesPersonId: true },
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

  /** Ensure a client has an instance of every applicable active template step. */
  private async syncClientSteps(client: { id: string; tenantId: string; emailEnabled: boolean; linkedInEnabled: boolean }) {
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
    const toCreate = template.filter((t) => !have.has(t.key));
    if (toCreate.length) {
      await this.prisma.clientSetupStep.createMany({
        data: toCreate.map((t) => ({
          tenantId: client.tenantId, clientId: client.id, templateKey: t.key,
          label: t.label, group: t.group, order: t.order,
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Full checklist + progress for one client (creating any missing steps first). */
  async clientDetail(user: AuthUser, clientId: string) {
    const client = await this.loadScopedClient(user, clientId);
    await this.syncClientSteps(client);
    const steps = await this.prisma.clientSetupStep.findMany({
      where: { clientId },
      orderBy: [{ group: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
      include: { events: { orderBy: { at: 'desc' }, take: 10 } },
    });
    const total = steps.length;
    const finished = steps.filter((s) => s.status === 'FINISHED').length;
    const started = steps.filter((s) => s.status === 'STARTED').length;
    return {
      client: { id: client.id, name: client.name, emailEnabled: client.emailEnabled, linkedInEnabled: client.linkedInEnabled },
      progress: { total, finished, started, percent: total ? Math.round((finished / total) * 100) : 0 },
      steps,
    };
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
          where: { clientId: { in: clientIds } },
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
