import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  SupportStatus,
  SupportReplyRole,
  SupportSatisfaction,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateTicketDto,
  EscalateDto,
  FeedbackDto,
  ReplyDto,
  ResolveEscalationDto,
  UpdateTicketDto,
} from './dto/support.dto';

const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_BYTES = 5 * 1024 * 1024;

interface AttachmentInput {
  attachmentBase64?: string;
  attachmentName?: string;
  attachmentMime?: string;
}

/** A decoded attachment ready to persist or email. */
interface Attachment {
  data: Buffer;
  name: string;
  mime: string;
}

/** Shape a decoded attachment for nodemailer (so it rides along in the alert email). */
function toEmailAttachments(a?: Attachment | null) {
  return a ? [{ filename: a.name, content: a.data, contentType: a.mime }] : undefined;
}

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private notify: NotifyService,
  ) {}

  private isAdmin(user: AuthUser) {
    return user.role === Role.SUPER_ADMIN || user.role === Role.SUB_ADMIN;
  }

  // ───────────────────────────── Client portal ─────────────────────────────

  /** Workspaces the portal user owns + the support contact for each (account
   *  manager if assigned, otherwise the generic support desk). */
  async myContext(user: AuthUser) {
    const clients = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: {
        id: true,
        name: true,
        salesPerson: { select: { id: true, name: true, email: true, contactMobile: true } },
      },
      orderBy: { name: 'asc' },
    });
    return {
      workspaces: clients.map((c) => ({
        id: c.id,
        name: c.name,
        manager: c.salesPerson
          ? {
              name: c.salesPerson.name,
              email: c.salesPerson.email,
              phone: c.salesPerson.contactMobile,
            }
          : null,
      })),
      generic: {
        email: process.env.SUPPORT_EMAIL || 'support@grapme.com',
        phone: process.env.SUPPORT_PHONE || '',
      },
    };
  }

  /** The portal user's own tickets. */
  async myTickets(user: AuthUser) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { lastReplyAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        satisfaction: true,
        lastReplyAt: true,
        lastReplyRole: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
        assignedTo: { select: { name: true } },
      },
    });
    return tickets;
  }

  /** Raise a ticket. Routes to the client's salesperson, else all admins/sub-admins. */
  async createTicket(user: AuthUser, dto: CreateTicketDto) {
    const client = await this.resolveOwnedClient(user, dto.clientId);
    const attachment = this.decodeAttachment(dto);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        clientId: client.id,
        subject: dto.subject.trim(),
        category: dto.category?.trim() || null,
        status: SupportStatus.OPEN,
        assignedToId: client.salesPersonId, // "Handled by" reflects the salesperson
        lastReplyAt: new Date(),
        lastReplyRole: SupportReplyRole.CLIENT,
        messages: {
          create: {
            userId: user.userId,
            body: dto.message.trim(),
            attachmentData: attachment?.data ?? null,
            attachmentName: attachment?.name ?? null,
            attachmentMime: attachment?.mime ?? null,
          },
        },
      },
      select: { id: true, subject: true },
    });

    await this.routeToStaff(
      user,
      { id: ticket.id, subject: ticket.subject, salesPersonId: client.salesPersonId },
      `New support ticket from ${client.name}`,
      dto.message,
      attachment,
    );
    return { id: ticket.id };
  }

  /** Full thread for a ticket the portal user owns. */
  async myTicket(user: AuthUser, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.userId },
      include: this.threadInclude(),
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.serializeThread(ticket);
  }

  /** Client reply (only while the ticket is open/answered). Reopens + routes to staff. */
  async myReply(user: AuthUser, id: string, dto: ReplyDto) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.userId },
      select: { id: true, subject: true, status: true, clientId: true, client: { select: { name: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === SupportStatus.CLOSED)
      throw new BadRequestException('This ticket is closed. Please raise a new one.');
    const attachment = this.decodeAttachment(dto);
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          userId: user.userId,
          body: dto.message.trim(),
          attachmentData: attachment?.data ?? null,
          attachmentName: attachment?.name ?? null,
          attachmentMime: attachment?.mime ?? null,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: SupportStatus.OPEN, // a client reply reopens the ticket
          lastReplyAt: new Date(),
          lastReplyRole: SupportReplyRole.CLIENT,
        },
      }),
    ]);
    const salesPersonId = await this.clientSalesPersonId(ticket.clientId);
    // Name the client (company/person) so staff know which account the reply is about.
    const regarding = ticket.client?.name?.trim();
    await this.routeToStaff(
      user,
      { id: ticket.id, subject: ticket.subject, salesPersonId },
      regarding ? `New reply on ticket "${ticket.subject}" — ${regarding}` : `New reply on ticket "${ticket.subject}"`,
      dto.message,
      attachment,
    );
    return { ok: true };
  }

  /** Optional satisfaction rating once the ticket has been handled. */
  async myFeedback(user: AuthUser, id: string, dto: FeedbackDto) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.userId },
      select: { id: true, status: true, assignedToId: true, subject: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === SupportStatus.OPEN)
      throw new BadRequestException('You can rate this ticket once it has been answered.');
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        satisfaction: dto.satisfaction as SupportSatisfaction,
        satisfactionNote: dto.note?.trim() || null,
      },
    });
    // Let the handler know feedback landed (best-effort).
    if (ticket.assignedToId) {
      await this.notify.notify(ticket.assignedToId, {
        type: 'support',
        title: `Feedback on "${ticket.subject}"`,
        body: `Client marked the ticket ${dto.satisfaction === 'SATISFIED' ? 'Satisfied' : 'Not satisfied'}.${dto.note ? ` "${dto.note.trim()}"` : ''}`,
        link: `/support?ticket=${ticket.id}`,
      });
    }
    return { ok: true };
  }

  // ───────────────────────────── Staff + sales console ─────────────────────────────

  /** Ticket list for staff (all) or sales (only their clients'), with filters. */
  async listTickets(
    user: AuthUser,
    query: { status?: string; escalated?: string; handledBy?: string },
  ) {
    const where = this.staffScopeWhere(user);
    if (query.status && ['OPEN', 'ANSWERED', 'RESOLVED', 'CLOSED'].includes(query.status)) {
      where.status = query.status as SupportStatus;
    }
    if (query.escalated === 'true') where.escalatedAt = { not: null };
    if (query.handledBy) where.assignedToId = query.handledBy;

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ escalatedAt: { sort: 'desc', nulls: 'last' } }, { lastReplyAt: 'desc' }],
      select: {
        id: true,
        subject: true,
        status: true,
        satisfaction: true,
        escalatedAt: true,
        lastReplyAt: true,
        lastReplyRole: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        client: { select: { id: true, name: true, email: true, mobile: true } },
        assignedTo: { select: { id: true, name: true, role: true } },
      },
    });
    return tickets;
  }

  /** Full thread for staff/sales (authorized). */
  async getTicket(user: AuthUser, id: string) {
    const ticket = await this.loadStaffTicket(user, id, { include: this.threadInclude() });
    return this.serializeThread(ticket, true);
  }

  /** Staff/sales reply → marks the ticket ANSWERED and notifies the client. */
  async staffReply(user: AuthUser, id: string, dto: ReplyDto) {
    const ticket = await this.loadStaffTicket(user, id, {
      select: { id: true, subject: true, userId: true, assignedToId: true, status: true },
    });
    if (ticket.status === SupportStatus.CLOSED)
      throw new BadRequestException('This ticket is closed.');
    const attachment = this.decodeAttachment(dto);
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          userId: user.userId,
          body: dto.message.trim(),
          attachmentData: attachment?.data ?? null,
          attachmentName: attachment?.name ?? null,
          attachmentMime: attachment?.mime ?? null,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: SupportStatus.ANSWERED,
          lastReplyAt: new Date(),
          lastReplyRole: SupportReplyRole.SUPPORT,
          // If nobody owned it yet, the replier takes it.
          ...(ticket.assignedToId ? {} : { assignedToId: user.userId }),
        },
      }),
    ]);
    // Notify the client (best-effort, per their preferences) — the attachment (if any)
    // rides along in the email so they get it directly.
    await this.notify.notify(ticket.userId, {
      type: 'support',
      title: `Reply on your ticket "${ticket.subject}"`,
      body: dto.message,
      link: `/support?ticket=${ticket.id}`,
      emailAttachments: toEmailAttachments(attachment),
    });
    return { ok: true };
  }

  /** Admin: change status and/or reassign the handler. */
  async updateTicket(user: AuthUser, id: string, dto: UpdateTicketDto) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Admins only');
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const data: Record<string, unknown> = {};
    if (dto.status) data.status = dto.status as SupportStatus;
    if (dto.assignedToId !== undefined) {
      if (dto.assignedToId) {
        const handler = await this.prisma.user.findFirst({
          where: {
            id: dto.assignedToId,
            tenantId: user.tenantId,
            role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES] },
          },
          select: { id: true },
        });
        if (!handler) throw new BadRequestException('Invalid handler');
        data.assignedToId = dto.assignedToId;
      } else {
        data.assignedToId = null;
      }
    }
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data,
      select: { id: true, status: true, assignedToId: true },
    });
    return updated;
  }

  /** Handler dropdown source: admins, sub-admins, and salespersons (with role). */
  handlers(user: AuthUser) {
    return this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES] },
        status: 'ACTIVE',
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  /** Sales escalates a ticket to admins/sub-admins. */
  async escalate(user: AuthUser, id: string, dto: EscalateDto) {
    if (user.role !== Role.SALES) throw new ForbiddenException('Only salespersons can escalate');
    const ticket = await this.loadStaffTicket(user, id, {
      select: { id: true, subject: true, escalatedAt: true, client: { select: { name: true } } },
    });
    if (ticket.escalatedAt) throw new BadRequestException('Already escalated');
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        escalatedAt: new Date(),
        escalatedById: user.userId,
        escalationNote: dto.note?.trim() || null,
      },
    });
    const admins = await this.adminIds(user.tenantId);
    await this.notify.notifyMany(admins, {
      type: 'support',
      title: `Ticket escalated: "${ticket.subject}"`,
      body: `${user.email} escalated a ticket${ticket.client ? ` for ${ticket.client.name}` : ''}.${dto.note ? ` Note: ${dto.note.trim()}` : ''}`,
      link: `/support?ticket=${ticket.id}`,
    });
    return { ok: true };
  }

  /** Admin/sub-admin resolves an escalation and notifies the escalating salesperson. */
  async resolveEscalation(user: AuthUser, id: string, dto: ResolveEscalationDto) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Admins only');
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, subject: true, escalatedAt: true, escalatedById: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!ticket.escalatedAt) throw new BadRequestException('Ticket is not escalated');
    const notifyBack = ticket.escalatedById;
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { escalatedAt: null, escalatedById: null },
    });
    if (notifyBack) {
      await this.notify.notify(notifyBack, {
        type: 'support',
        title: `Escalation resolved: "${ticket.subject}"`,
        body: `${user.email} resolved your escalation.${dto.note ? ` Note: ${dto.note.trim()}` : ''}`,
        link: `/support?ticket=${ticket.id}`,
      });
    }
    return { ok: true };
  }

  /** Nav badge: tickets OPEN or ESCALATED (scoped for sales). */
  async badge(user: AuthUser) {
    if (user.role === Role.CLIENT) {
      const count = await this.prisma.supportTicket.count({
        where: { tenantId: user.tenantId, userId: user.userId, status: SupportStatus.ANSWERED },
      });
      return { count };
    }
    const scope = this.staffScopeWhere(user);
    const count = await this.prisma.supportTicket.count({
      where: { ...scope, OR: [{ status: SupportStatus.OPEN }, { escalatedAt: { not: null } }] },
    });
    return { count };
  }

  // ───────────────────────────── Attachment download (gated) ─────────────────────────────

  async downloadAttachment(user: AuthUser, messageId: string) {
    const msg = await this.prisma.supportMessage.findFirst({
      where: { id: messageId, ticket: { tenantId: user.tenantId } },
      select: {
        attachmentData: true,
        attachmentName: true,
        attachmentMime: true,
        ticket: { select: { userId: true, client: { select: { salesPersonId: true } } } },
      },
    });
    if (!msg) throw new NotFoundException('Attachment not found');

    const isOwner = msg.ticket.userId === user.userId;
    const isAssignedSales =
      user.role === Role.SALES && msg.ticket.client?.salesPersonId === user.userId;
    if (!(isOwner || this.isAdmin(user) || isAssignedSales)) {
      throw new ForbiddenException('Not allowed');
    }
    if (!msg.attachmentData) throw new NotFoundException('No attachment on this message');
    return {
      data: Buffer.from(msg.attachmentData),
      name: msg.attachmentName || 'attachment',
      mime: msg.attachmentMime || 'application/octet-stream',
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /** WHERE clause scoping a staff/sales list. Sales: only their clients' tickets. */
  private staffScopeWhere(user: AuthUser): Record<string, any> {
    const where: Record<string, any> = { tenantId: user.tenantId };
    if (user.role === Role.SALES) {
      where.client = { salesPersonId: user.userId };
    }
    return where;
  }

  /** Load a ticket for a staff/sales actor, enforcing the sales scope. */
  private async loadStaffTicket(
    user: AuthUser,
    id: string,
    args: { select?: any; include?: any },
  ) {
    const where = this.staffScopeWhere(user);
    where.id = id;
    const ticket = await this.prisma.supportTicket.findFirst({ where, ...args } as any);
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket as any;
  }

  private async resolveOwnedClient(user: AuthUser, clientId?: string) {
    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, tenantId: user.tenantId, ownerUserId: user.userId },
        select: { id: true, name: true, salesPersonId: true },
      });
      if (!client) throw new ForbiddenException('Not your workspace');
      return client;
    }
    const owned = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true, name: true, salesPersonId: true },
    });
    if (owned.length === 0) throw new BadRequestException('You have no workspace yet.');
    if (owned.length > 1) throw new BadRequestException('Please choose which workspace this ticket is about.');
    return owned[0];
  }

  private async clientSalesPersonId(clientId: string | null): Promise<string | null> {
    if (!clientId) return null;
    const c = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { salesPersonId: true },
    });
    return c?.salesPersonId ?? null;
  }

  private async adminIds(tenantId: string): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: { tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  /** Route a client-side event to the salesperson (if any) else all admins. */
  private async routeToStaff(
    _actor: AuthUser,
    ticket: { id: string; subject: string; salesPersonId: string | null },
    title: string,
    preview: string,
    attachment?: Attachment | null,
  ) {
    const recipients = ticket.salesPersonId
      ? [ticket.salesPersonId]
      : await this.adminIds(_actor.tenantId);
    await this.notify.notifyMany(recipients, {
      type: 'support',
      title,
      body: preview,
      link: `/support?ticket=${ticket.id}`,
      emailAttachments: toEmailAttachments(attachment),
    });
  }

  private threadInclude() {
    return {
      messages: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          body: true,
          createdAt: true,
          userId: true,
          attachmentName: true,
          attachmentMime: true,
          user: { select: { name: true, role: true } },
        },
      },
      client: { select: { id: true, name: true, email: true, mobile: true } },
      user: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, role: true } },
      escalatedBy: { select: { id: true, name: true } },
    };
  }

  /** Shape a ticket + messages for the UI (never leaks attachment bytes). */
  private serializeThread(ticket: any, staffView = false) {
    return {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      satisfaction: ticket.satisfaction,
      satisfactionNote: ticket.satisfactionNote,
      escalatedAt: ticket.escalatedAt,
      escalationNote: staffView ? ticket.escalationNote : undefined,
      escalatedBy: staffView ? ticket.escalatedBy : undefined,
      createdAt: ticket.createdAt,
      lastReplyAt: ticket.lastReplyAt,
      client: ticket.client,
      raisedBy: ticket.user,
      handledBy: ticket.assignedTo,
      messages: (ticket.messages ?? []).map((m: any) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        // "support" side = anyone who isn't the ticket's owner (the client).
        side: m.userId === ticket.userId ? 'client' : 'support',
        authorName: m.user?.name ?? 'User',
        attachment: m.attachmentName
          ? { name: m.attachmentName, mime: m.attachmentMime }
          : null,
      })),
    };
  }

  private decodeAttachment(dto: AttachmentInput): Attachment | null {
    if (!dto.attachmentBase64) return null;
    const mime = (dto.attachmentMime || '').toLowerCase();
    if (!ALLOWED_MIME.includes(mime)) {
      throw new BadRequestException('Unsupported file type. Allowed: PDF, image, Word, or Excel.');
    }
    const base64 = dto.attachmentBase64.replace(/^data:[^;]+;base64,/, '');
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0) throw new BadRequestException('Empty file.');
    if (data.length > MAX_BYTES) throw new BadRequestException('File too large (max 5 MB).');
    return { data, name: (dto.attachmentName || 'attachment').slice(0, 200), mime };
  }
}
