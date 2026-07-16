import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Role, UpdateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateUpdateDto, ReplyUpdateDto } from './dto/update.dto';

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER];

/**
 * Work / Meetings / Notification board. A thread belongs to a client workspace and
 * is two-way: admins/sub-admins and the owning client can both post and reply.
 * Every event fans out a bell Notification to the counterparties, plus an optional
 * email copy (per-item toggle) and a WhatsApp stub (recorded intent only for now).
 */
@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  private isAdmin(user: AuthUser) { return ADMIN_ROLES.includes(user.role as Role); }

  /** Client ids the user may see/post to: admins → all in tenant, client → owned. */
  private async allowedClientIds(user: AuthUser): Promise<string[]> {
    const where: Prisma.ClientWhereInput = this.isAdmin(user)
      ? { tenantId: user.tenantId }
      : { tenantId: user.tenantId, ownerUserId: user.userId };
    const rows = await this.prisma.client.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async assertClientAccess(user: AuthUser, clientId: string) {
    const ok = this.isAdmin(user)
      ? await this.prisma.client.count({ where: { id: clientId, tenantId: user.tenantId } })
      : await this.prisma.client.count({ where: { id: clientId, ownerUserId: user.userId } });
    if (!ok) throw new ForbiddenException('You do not have access to this client');
  }

  /** Clients the current user can file updates under (for the composer's picker). */
  async clientOptions(user: AuthUser) {
    const where: Prisma.ClientWhereInput = this.isAdmin(user)
      ? { tenantId: user.tenantId }
      : { tenantId: user.tenantId, ownerUserId: user.userId };
    return this.prisma.client.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  // ── list / read ──────────────────────────────────────────────────────
  async list(user: AuthUser, opts: { type?: UpdateType; clientId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 15));
    const allowed = await this.allowedClientIds(user);
    // A client with no workspace yet sees an empty board.
    if (allowed.length === 0) return { total: 0, page, pageSize, pages: 0, items: [], clientNames: {} };

    const clientFilter = opts.clientId && allowed.includes(opts.clientId) ? [opts.clientId] : allowed;
    const where: Prisma.UpdateThreadWhereInput = {
      tenantId: user.tenantId,
      clientId: { in: clientFilter },
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.search
        ? { OR: [
            { title: { contains: opts.search, mode: 'insensitive' } },
            { bodyHtml: { contains: opts.search, mode: 'insensitive' } },
            { authorName: { contains: opts.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.updateThread.count({ where }),
      this.prisma.updateThread.findMany({
        where, orderBy: { lastActivityAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { _count: { select: { replies: true } } },
      }),
    ]);
    // Denormalized client names so the admin list can label each row's workspace.
    const clients = await this.prisma.client.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.clientId))] } }, select: { id: true, name: true },
    });
    const clientNames = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), items, clientNames };
  }

  async get(user: AuthUser, id: string) {
    const thread = await this.prisma.updateThread.findUnique({
      where: { id },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!thread || thread.tenantId !== user.tenantId) throw new NotFoundException('Update not found');
    await this.assertClientAccess(user, thread.clientId);
    const client = await this.prisma.client.findUnique({ where: { id: thread.clientId }, select: { name: true } });
    return { ...thread, clientName: client?.name ?? null };
  }

  // ── create / reply ───────────────────────────────────────────────────
  async create(user: AuthUser, dto: CreateUpdateDto) {
    await this.assertClientAccess(user, dto.clientId);
    const author = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    const thread = await this.prisma.updateThread.create({
      data: {
        tenantId: user.tenantId,
        clientId: dto.clientId,
        type: dto.type,
        title: dto.title.trim(),
        bodyHtml: sanitizeHtml(dto.bodyHtml),
        authorUserId: user.userId,
        authorRole: user.role as Role,
        authorName: author?.name ?? author?.email ?? 'Someone',
        notifyEmail: !!dto.notifyEmail,
        notifyWhatsapp: !!dto.notifyWhatsapp,
        lastActivityAt: new Date(),
        lastActorUserId: user.userId,
      },
    });
    await this.fanOut(thread.id, user, `New ${typeLabel(thread.type)}: ${thread.title}`, stripHtml(thread.bodyHtml), thread.bodyHtml);
    return this.get(user, thread.id);
  }

  async reply(user: AuthUser, id: string, dto: ReplyUpdateDto) {
    const thread = await this.prisma.updateThread.findUnique({ where: { id }, select: { id: true, tenantId: true, clientId: true, title: true, type: true } });
    if (!thread || thread.tenantId !== user.tenantId) throw new NotFoundException('Update not found');
    await this.assertClientAccess(user, thread.clientId);
    const author = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    await this.prisma.updateReply.create({
      data: {
        threadId: id,
        body: dto.body.trim(),
        authorUserId: user.userId,
        authorRole: user.role as Role,
        authorName: author?.name ?? author?.email ?? 'Someone',
      },
    });
    await this.prisma.updateThread.update({ where: { id }, data: { lastActivityAt: new Date(), lastActorUserId: user.userId } });
    await this.fanOut(id, user, `New reply on: ${thread.title}`, dto.body.trim());
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Admins only');
    const thread = await this.prisma.updateThread.findUnique({ where: { id }, select: { tenantId: true } });
    if (!thread || thread.tenantId !== user.tenantId) throw new NotFoundException('Update not found');
    await this.prisma.updateThread.delete({ where: { id } });
    return { ok: true };
  }

  // ── notifications fan-out (bell + email + WhatsApp stub) ──────────────
  /**
   * Notify the counterparties of an event: a bell Notification for everyone on the
   * other side, an email copy to the "other side" (if the thread's email toggle is
   * on), and a recorded-only WhatsApp stub.
   */
  private async fanOut(threadId: string, actor: AuthUser, title: string, preview: string, bodyHtml?: string) {
    const thread = await this.prisma.updateThread.findUnique({
      where: { id: threadId },
      select: { clientId: true, tenantId: true, notifyEmail: true, notifyWhatsapp: true },
    });
    if (!thread) return;

    const [client, admins] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: thread.clientId }, select: { ownerUserId: true, name: true, email: true, mobile: true } }),
      this.prisma.user.findMany({
        where: { tenantId: thread.tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const clientOwner = client?.ownerUserId
      ? await this.prisma.user.findUnique({ where: { id: client.ownerUserId }, select: { id: true, email: true, name: true } })
      : null;

    const actorIsClient = actor.role === Role.CLIENT;
    // Bell → everyone on the board except the actor (both sides stay in the loop).
    const bellUserIds = new Set<string>();
    admins.forEach((a) => bellUserIds.add(a.id));
    if (clientOwner) bellUserIds.add(clientOwner.id);
    bellUserIds.delete(actor.userId);
    const link = `/updates?thread=${threadId}`;
    if (bellUserIds.size) {
      await this.prisma.notification.createMany({
        data: [...bellUserIds].map((userId) => ({ userId, type: 'update', title, body: preview.slice(0, 280), link })),
      });
    }

    // Email → the OTHER side only (client→admins, admin→client), if the toggle is on.
    if (thread.notifyEmail) {
      const emailTargets = actorIsClient
        ? (admins.map((a) => a.email).filter(Boolean) as string[])
        : ([client?.email, clientOwner?.email].filter(Boolean) as string[]);
      // Use the sanitized rich body for the email so bold/italic/lists/links render;
      // fall back to escaped plain text (e.g. for replies, which are plain).
      const emailBody = bodyHtml ?? `<p style="white-space:pre-wrap;margin:0">${escapeHtml(preview)}</p>`;
      await this.emailCopy(thread.tenantId, emailTargets, title, emailBody, link);
    }

    // WhatsApp → recorded stub only (no send until a provider is wired).
    if (thread.notifyWhatsapp) {
      const mobile = actorIsClient ? '(agency)' : client?.mobile ?? '(no number on file)';
      this.logger.log(`[whatsapp-stub] would notify ${mobile} — "${title}". Wire WHATSAPP_TOKEN/PHONE_ID to enable.`);
    }
  }

  private async emailCopy(tenantId: string, to: string[], subject: string, bodyHtml: string, link: string) {
    const targets = [...new Set(to.filter(Boolean))];
    if (targets.length === 0) return;
    const account = await this.systemMailbox(tenantId);
    if (!account) { this.logger.warn(`No sending mailbox for tenant ${tenantId}; skipped update email.`); return; }
    // Same public web URL the auth emails use (verify/reset links), so the button is
    // an absolute link that opens the app (→ client login if not signed in).
    const webUrl = (process.env.WEB_PUBLIC_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    const href = `${webUrl}${link}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#0f766e;font-size:18px">${escapeHtml(subject)}</h2>
        <div style="color:#334155;font-size:14px;line-height:1.6;word-break:break-word">${bodyHtml}</div>
        <p style="margin:22px 0">
          <a href="${href}" style="background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open in GrapMe</a>
        </p>
        <p style="color:#94a3b8;font-size:12px">You're receiving this because notifications are enabled for this update.</p>
      </div>`;
    for (const addr of targets) {
      try {
        await this.mailer.send({ account, to: addr, subject, html });
      } catch (err) {
        this.logger.warn(`Update email to ${addr} failed: ${err}`);
      }
    }
  }

  private async systemMailbox(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { reportMailboxId: true } });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({ where: { id: tenant.reportMailboxId } });
      if (acct) return acct;
    }
    return this.prisma.emailAccount.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  // ── bell feed ────────────────────────────────────────────────────────
  async bellUnreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({ where: { userId: user.userId, read: false } });
    return { count };
  }

  async bellFeed(user: AuthUser) {
    const items = await this.prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const unread = items.filter((i) => !i.read).length;
    return { unread, items };
  }

  async bellMarkSeen(user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.userId, read: false }, data: { read: true } });
    return { ok: true };
  }

  /** Clear only the bell notifications tied to one thread (when the user opens it). */
  async markThreadSeen(user: AuthUser, threadId: string) {
    await this.prisma.notification.updateMany({
      where: { userId: user.userId, read: false, link: `/updates?thread=${threadId}` },
      data: { read: true },
    });
    return { ok: true };
  }
}

// ── helpers ────────────────────────────────────────────────────────────
function typeLabel(t: UpdateType): string {
  return t === 'WORK' ? 'Work update' : t === 'MEETING' ? 'Meeting' : 'Notification';
}

/** Minimal HTML sanitizer: drop scripts/iframes, inline event handlers and javascript: URLs. */
function sanitizeHtml(html: string): string {
  return (html ?? '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1=$2#$2')
    .slice(0, 20000);
}

function stripHtml(html: string): string {
  return (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
