import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { MailerService } from '../sending/mailer.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  AssignClientsDto,
  CreateSalesPersonDto,
  UpdateSalesPersonDto,
} from './dto/sales.dto';

/** Parse page/pageSize query strings into Prisma skip/take + echo the resolved values. */
function pageArgs(page?: string, pageSize?: string) {
  const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}

/** Fields safe to return for a client row in the salesperson's scoped views. */
const CLIENT_CARD_SELECT = {
  id: true,
  name: true,
  contactPerson: true,
  email: true,
  mobile: true,
  status: true,
  plan: true,
  emailEnabled: true,
  linkedInEnabled: true,
  validityEndAt: true,
} as const;

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private mailer: MailerService,
  ) {}

  // ─────────────────────────── Admin: manage salespersons ───────────────────────────

  /** All salespersons with their assigned-client count. */
  async listPersons(tenantId: string) {
    const persons = await this.prisma.user.findMany({
      where: { tenantId, role: Role.SALES },
      select: {
        id: true,
        name: true,
        email: true,
        contactMobile: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (persons.length === 0) return [];
    const grouped = await this.prisma.client.groupBy({
      by: ['salesPersonId'],
      where: { tenantId, salesPersonId: { in: persons.map((p) => p.id) } },
      _count: { _all: true },
    });
    const countBy = new Map(grouped.map((g) => [g.salesPersonId, g._count._all]));
    return persons.map((p) => ({ ...p, assignedCount: countBy.get(p.id) ?? 0 }));
  }

  /** Salesperson detail + their assigned clients (read-only sub-list for the edit page). */
  async getPerson(tenantId: string, id: string) {
    const person = await this.assertSales(tenantId, id);
    const clients = await this.prisma.client.findMany({
      where: { tenantId, salesPersonId: id },
      select: CLIENT_CARD_SELECT,
      orderBy: { name: 'asc' },
    });
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      mobile: person.contactMobile,
      status: person.status,
      lastLoginAt: person.lastLoginAt,
      clients,
    };
  }

  /** Create a salesperson login (role SALES, active, email pre-verified) + welcome mail. */
  async create(actor: AuthUser, dto: CreateSalesPersonDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already in use');
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        tenantId: actor.tenantId,
        name: dto.name.trim(),
        email,
        passwordHash,
        role: Role.SALES,
        status: UserStatus.ACTIVE,
        emailVerified: true, // can log in immediately
        contactMobile: dto.mobile?.trim() || null,
      },
      select: { id: true, name: true, email: true },
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'CREATE_SALESPERSON',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email },
    });
    // Transactional welcome — always attempted regardless of preferences.
    await this.sendWelcome(actor.tenantId, user.id, user.name, user.email);
    return user;
  }

  /** Update a salesperson (blank password keeps the current one). */
  async update(actor: AuthUser, id: string, dto: UpdateSalesPersonDto) {
    await this.assertSales(actor.tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.mobile !== undefined) data.contactMobile = dto.mobile.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.email) {
      const email = dto.email.toLowerCase().trim();
      const clash = await this.prisma.user.findUnique({ where: { email } });
      if (clash && clash.id !== id) throw new ConflictException('Email already in use');
      data.email = email;
    }
    if (dto.password) data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, contactMobile: true, status: true },
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'UPDATE_SALESPERSON',
      entityType: 'User',
      entityId: id,
      after: { passwordChanged: !!dto.password },
    });
    return user;
  }

  /** Delete a salesperson. Their clients (salesPersonId) and tickets (assignedToId)
   *  are set NULL by the FK, so nothing is orphaned. */
  async remove(actor: AuthUser, id: string) {
    const person = await this.assertSales(actor.tenantId, id);
    await this.prisma.user.delete({ where: { id } });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'DELETE_SALESPERSON',
      entityType: 'User',
      entityId: id,
      after: { email: person.email },
    });
    return { success: true };
  }

  /** Assign (or unassign, when salesPersonId is empty) many clients at once. */
  async assignClients(actor: AuthUser, dto: AssignClientsDto) {
    const salesPersonId = dto.salesPersonId || null;
    if (salesPersonId) await this.assertSales(actor.tenantId, salesPersonId);
    const res = await this.prisma.client.updateMany({
      where: { tenantId: actor.tenantId, id: { in: dto.clientIds } },
      data: { salesPersonId },
    });
    // Backfill: hand any still-unassigned tickets of these clients to the new owner.
    if (salesPersonId) {
      await this.prisma.supportTicket.updateMany({
        where: { tenantId: actor.tenantId, clientId: { in: dto.clientIds }, assignedToId: null },
        data: { assignedToId: salesPersonId },
      });
    }
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: salesPersonId ? 'ASSIGN_SALESPERSON' : 'UNASSIGN_SALESPERSON',
      entityType: 'Client',
      entityId: dto.clientIds.join(','),
      after: { salesPersonId, count: res.count },
    });
    return { success: true, count: res.count };
  }

  /** Unassign a single client from a salesperson (from the salesperson's edit page). */
  async unassignClient(actor: AuthUser, salesPersonId: string, clientId: string) {
    const res = await this.prisma.client.updateMany({
      where: { tenantId: actor.tenantId, id: clientId, salesPersonId },
      data: { salesPersonId: null },
    });
    if (res.count === 0) throw new NotFoundException('Client is not assigned to this salesperson');
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'UNASSIGN_SALESPERSON',
      entityType: 'Client',
      entityId: clientId,
      after: { salesPersonId },
    });
    return { success: true };
  }

  // ─────────────────────────── Sales-scoped (role SALES) ───────────────────────────

  /** The salesperson's own clients (read-only). */
  myClients(user: AuthUser) {
    return this.prisma.client.findMany({
      where: { tenantId: user.tenantId, salesPersonId: user.userId },
      select: CLIENT_CARD_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Read-only detail of ONE of the salesperson's own clients (403 otherwise). */
  async myClient(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId, salesPersonId: user.userId },
      select: {
        ...CLIENT_CARD_SELECT,
        invoiceNo: true,
        productCategory: true,
        serviceType: true,
        plan: true,
        validityStartAt: true,
        createdAt: true,
      },
    });
    if (!client) throw new ForbiddenException('Not your client');
    return client;
  }

  /** Scoped dashboard stats for the logged-in salesperson. */
  async myOverview(user: AuthUser) {
    const salesPersonId = user.userId;
    const clients = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, salesPersonId },
      select: { emailEnabled: true, linkedInEnabled: true, validityEndAt: true },
    });
    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1000;
    let emailCount = 0;
    let linkedInCount = 0;
    let expiringSoon = 0;
    let expired = 0;
    for (const c of clients) {
      if (c.emailEnabled) emailCount++;
      if (c.linkedInEnabled) linkedInCount++;
      const end = c.validityEndAt ? new Date(c.validityEndAt).getTime() : null;
      if (end !== null) {
        if (end < now) expired++;
        else if (end <= soon) expiringSoon++;
      }
    }
    const openTickets = await this.prisma.supportTicket.count({
      where: {
        tenantId: user.tenantId,
        client: { salesPersonId },
        status: { in: ['OPEN', 'ANSWERED'] },
      },
    });
    return {
      total: clients.length,
      emailCount,
      linkedInCount,
      expiringSoon,
      expired,
      openTickets,
    };
  }

  // ─────────────── Sales: read-only drill-down into an owned client ───────────────

  /** Throws unless the client belongs to this salesperson. */
  private async assertOwnedClient(user: AuthUser, clientId: string) {
    const c = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId, salesPersonId: user.userId },
      select: { id: true },
    });
    if (!c) throw new ForbiddenException('Not your client');
  }

  async clientStats(user: AuthUser, clientId: string) {
    await this.assertOwnedClient(user, clientId);
    const [emailCampaigns, cohorts, contacts, liCampaigns, liLeads] = await Promise.all([
      this.prisma.campaign.count({ where: { clientId } }),
      this.prisma.cohort.count({ where: { clientId } }),
      this.prisma.contact.count({ where: { clientId } }),
      this.prisma.liCampaign.count({ where: { clientId, deletedAt: null } }),
      this.prisma.liLead.count({ where: { campaign: { clientId } } }),
    ]);
    return { emailCampaigns, cohorts, contacts, liCampaigns, liLeads };
  }

  async clientCampaigns(user: AuthUser, clientId: string, page?: string, pageSize?: string) {
    await this.assertOwnedClient(user, clientId);
    const { skip, take, ...meta } = pageArgs(page, pageSize);
    const where = { clientId };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take,
        select: { id: true, name: true, status: true, startAt: true, createdAt: true },
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, total, ...meta };
  }

  async clientCohorts(user: AuthUser, clientId: string, page?: string, pageSize?: string) {
    await this.assertOwnedClient(user, clientId);
    const { skip, take, ...meta } = pageArgs(page, pageSize);
    const where = { clientId };
    const [items, total] = await Promise.all([
      this.prisma.cohort.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take,
        select: { id: true, label: true, status: true, monthIndex: true, startDate: true, endedAt: true },
      }),
      this.prisma.cohort.count({ where }),
    ]);
    return { items, total, ...meta };
  }

  async clientContacts(user: AuthUser, clientId: string, page?: string, pageSize?: string) {
    await this.assertOwnedClient(user, clientId);
    const { skip, take, ...meta } = pageArgs(page, pageSize);
    const where = { clientId };
    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take,
        select: { id: true, email: true, firstName: true, lastName: true, company: true, country: true, status: true },
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { items, total, ...meta };
  }

  async clientLiCampaigns(user: AuthUser, clientId: string, page?: string, pageSize?: string) {
    await this.assertOwnedClient(user, clientId);
    const { skip, take, ...meta } = pageArgs(page, pageSize);
    const where = { clientId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.liCampaign.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take,
        select: { id: true, name: true, status: true, createdAt: true },
      }),
      this.prisma.liCampaign.count({ where }),
    ]);
    return { items, total, ...meta };
  }

  async clientLiLeads(user: AuthUser, clientId: string, page?: string, pageSize?: string) {
    await this.assertOwnedClient(user, clientId);
    const { skip, take, ...meta } = pageArgs(page, pageSize);
    const where = { campaign: { clientId } };
    const [items, total] = await Promise.all([
      this.prisma.liLead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take,
        select: {
          id: true, fullName: true, title: true, company: true, location: true,
          status: true, connectedAt: true, profileUrl: true, lastReplyAt: true,
        },
      }),
      this.prisma.liLead.count({ where }),
    ]);
    return { items, total, ...meta };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async assertSales(tenantId: string, id: string) {
    const person = await this.prisma.user.findFirst({
      where: { id, tenantId, role: Role.SALES },
    });
    if (!person) throw new NotFoundException('Salesperson not found');
    return person;
  }

  /** Branded welcome with the admin login URL + a one-click set-password link. */
  private async sendWelcome(tenantId: string, userId: string, name: string, email: string) {
    const token = randomBytes(32).toString('hex');
    const webUrl = (process.env.WEB_PUBLIC_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    const setLink = `${webUrl}/reset?token=${token}`;
    const loginLink = `${webUrl}/login`;
    // Dev fallback: the link is always logged so onboarding works without SMTP.
    this.logger.log(`[salesperson-welcome] set-password link for ${email}: ${setLink}`);
    try {
      await this.prisma.passwordReset.create({
        data: {
          userId,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h for onboarding
        },
      });
    } catch (err) {
      this.logger.warn(`Welcome token create failed for ${email}: ${err}`);
      return;
    }
    try {
      const account = await this.prisma.tenant
        .findUnique({ where: { id: tenantId }, select: { reportMailboxId: true } })
        .then(async (t) => {
          if (t?.reportMailboxId) {
            const acct = await this.prisma.emailAccount.findUnique({ where: { id: t.reportMailboxId } });
            if (acct) return acct;
          }
          return this.prisma.emailAccount.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
        });
      if (!account) return;
      await this.mailer.send({
        account,
        to: email,
        subject: 'Welcome to GrapMe — set up your salesperson account',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#0f766e">Welcome${name ? `, ${name}` : ''} 👋</h2>
            <p style="color:#334155;font-size:14px;line-height:1.6">
              A salesperson account has been created for you on GrapMe. You'll manage
              your assigned clients and their support tickets from the admin panel.
            </p>
            <p style="margin:22px 0">
              <a href="${setLink}" style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Set your password</a>
            </p>
            <p style="color:#64748b;font-size:13px">
              Then sign in at <a href="${loginLink}">${loginLink}</a> with your email
              <strong>${email}</strong>.
            </p>
            <p style="color:#94a3b8;font-size:12px">The set-password link expires in 24 hours.</p>
          </div>`,
      });
    } catch (err) {
      this.logger.warn(`Welcome email to ${email} failed: ${err}`);
    }
  }
}
