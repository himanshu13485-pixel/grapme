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

  /** Which clients this user may see/post to: admins → all; salesperson → their
   *  assigned clients; client → the profiles they own. */
  private clientScopeWhere(user: AuthUser): Prisma.ClientWhereInput {
    if (this.isAdmin(user)) return { tenantId: user.tenantId };
    if (user.role === Role.SALES) return { tenantId: user.tenantId, salesPersonId: user.userId };
    return { tenantId: user.tenantId, ownerUserId: user.userId };
  }

  private async allowedClientIds(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.client.findMany({ where: this.clientScopeWhere(user), select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async assertClientAccess(user: AuthUser, clientId: string) {
    const ok = await this.prisma.client.count({ where: { id: clientId, ...this.clientScopeWhere(user) } });
    if (!ok) throw new ForbiddenException('You do not have access to this client');
  }

  /** Clients the current user can file updates under (for the composer's picker). */
  async clientOptions(user: AuthUser) {
    return this.prisma.client.findMany({ where: this.clientScopeWhere(user), select: { id: true, name: true }, orderBy: { name: 'asc' } });
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
        // Exclude the private attachmentData blob; expose only its name (for a paperclip chip).
        select: {
          id: true, tenantId: true, clientId: true, type: true, title: true, bodyHtml: true,
          authorUserId: true, authorRole: true, authorName: true, notifyEmail: true, notifyWhatsapp: true,
          attachmentName: true, attachmentMime: true, lastActivityAt: true, lastActorUserId: true,
          createdAt: true, updatedAt: true,
          _count: { select: { replies: true } },
        },
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
      // Explicit select excludes the private attachmentData blob — only its metadata
      // travels to the client; the bytes are served through the gated download route.
      select: {
        id: true, tenantId: true, clientId: true, type: true, title: true, bodyHtml: true,
        authorUserId: true, authorRole: true, authorName: true, notifyEmail: true, notifyWhatsapp: true,
        attachmentName: true, attachmentMime: true, lastActivityAt: true, lastActorUserId: true,
        createdAt: true, updatedAt: true,
        replies: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, threadId: true, body: true, authorUserId: true, authorRole: true, authorName: true,
            attachmentName: true, attachmentMime: true, createdAt: true,
          },
        },
      },
    });
    if (!thread || thread.tenantId !== user.tenantId) throw new NotFoundException('Update not found');
    await this.assertClientAccess(user, thread.clientId);
    const client = await this.prisma.client.findUnique({ where: { id: thread.clientId }, select: { name: true } });

    // Record that this viewer has seen the thread (monotonic), then compute the
    // "seen by" roster for the opening post + each reply (transparency receipts).
    const now = new Date();
    const me = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    await this.prisma.updateThreadRead.upsert({
      where: { threadId_userId: { threadId: id, userId: user.userId } },
      update: { seenAt: now, userName: me?.name ?? me?.email ?? 'Someone', userRole: user.role as Role },
      create: { threadId: id, userId: user.userId, userName: me?.name ?? me?.email ?? 'Someone', userRole: user.role as Role, seenAt: now },
    });
    const reads = await this.prisma.updateThreadRead.findMany({ where: { threadId: id } });
    const seenByAt = (at: Date, authorUserId: string) =>
      reads
        .map((r) => ({ ...r, seenAt: r.userId === user.userId ? now : r.seenAt })) // reflect this open now
        .filter((r) => r.userId !== authorUserId && r.seenAt >= at)
        .map((r) => ({ userId: r.userId, name: r.userName ?? 'Someone', role: r.userRole, at: r.seenAt }));

    return {
      ...thread,
      clientName: client?.name ?? null,
      seenBy: seenByAt(thread.createdAt, thread.authorUserId),
      replies: thread.replies.map((rep) => ({ ...rep, seenBy: seenByAt(rep.createdAt, rep.authorUserId) })),
    };
  }

  // ── create / reply ───────────────────────────────────────────────────
  async create(user: AuthUser, dto: CreateUpdateDto) {
    await this.assertClientAccess(user, dto.clientId);
    const author = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    const attachment = decodeAttachment(dto);
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
        attachmentData: attachment?.data ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
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
    const attachment = decodeAttachment(dto);
    await this.prisma.updateReply.create({
      data: {
        threadId: id,
        body: dto.body.trim(),
        authorUserId: user.userId,
        authorRole: user.role as Role,
        authorName: author?.name ?? author?.email ?? 'Someone',
        attachmentData: attachment?.data ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
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

  // ── attachment downloads (gated: same access as reading the thread) ───
  async downloadThreadAttachment(user: AuthUser, id: string) {
    const thread = await this.prisma.updateThread.findUnique({
      where: { id },
      select: { tenantId: true, clientId: true, attachmentData: true, attachmentName: true, attachmentMime: true },
    });
    if (!thread || thread.tenantId !== user.tenantId) throw new NotFoundException('Update not found');
    await this.assertClientAccess(user, thread.clientId);
    if (!thread.attachmentData) throw new NotFoundException('No attachment on this update');
    return {
      data: Buffer.from(thread.attachmentData),
      name: thread.attachmentName || 'attachment',
      mime: thread.attachmentMime || 'application/octet-stream',
    };
  }

  async downloadReplyAttachment(user: AuthUser, replyId: string) {
    const reply = await this.prisma.updateReply.findUnique({
      where: { id: replyId },
      select: {
        attachmentData: true, attachmentName: true, attachmentMime: true,
        thread: { select: { tenantId: true, clientId: true } },
      },
    });
    if (!reply || reply.thread.tenantId !== user.tenantId) throw new NotFoundException('Attachment not found');
    await this.assertClientAccess(user, reply.thread.clientId);
    if (!reply.attachmentData) throw new NotFoundException('No attachment on this reply');
    return {
      data: Buffer.from(reply.attachmentData),
      name: reply.attachmentName || 'attachment',
      mime: reply.attachmentMime || 'application/octet-stream',
    };
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
      this.prisma.client.findUnique({ where: { id: thread.clientId }, select: { ownerUserId: true, salesPersonId: true, name: true, email: true, mobile: true } }),
      this.prisma.user.findMany({
        where: { tenantId: thread.tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const clientOwner = client?.ownerUserId
      ? await this.prisma.user.findUnique({ where: { id: client.ownerUserId }, select: { id: true, email: true, name: true } })
      : null;
    // The client's salesperson is part of the agency side and stays in the loop.
    const salesPerson = client?.salesPersonId
      ? await this.prisma.user.findUnique({ where: { id: client.salesPersonId }, select: { id: true, email: true, name: true } })
      : null;

    const actorIsClient = actor.role === Role.CLIENT;
    // The company/person this thread is about (its client workspace) — so every alert
    // says which account it relates to, not just the thread title.
    const regarding = client?.name?.trim() || null;
    const subjectWithClient = regarding ? `${title} — ${regarding}` : title;
    // Bell → everyone on the board except the actor (both sides stay in the loop).
    const bellUserIds = new Set<string>();
    admins.forEach((a) => bellUserIds.add(a.id));
    if (clientOwner) bellUserIds.add(clientOwner.id);
    if (salesPerson) bellUserIds.add(salesPerson.id);
    bellUserIds.delete(actor.userId);
    const link = `/updates?thread=${threadId}`;
    if (bellUserIds.size) {
      const bellBody = (regarding ? `[${regarding}] ` : '') + preview;
      await this.prisma.notification.createMany({
        data: [...bellUserIds].map((userId) => ({ userId, type: 'update', title, body: bellBody.slice(0, 280), link })),
      });
    }

    // Email → the OTHER side only, if the toggle is on. Agency side = admins +
    // salesperson; client side = the client + its portal owner.
    if (thread.notifyEmail) {
      const emailTargets = actorIsClient
        ? ([...admins.map((a) => a.email), salesPerson?.email].filter(Boolean) as string[])
        : ([client?.email, clientOwner?.email].filter(Boolean) as string[]);
      // Lead with a "Regarding: <client>" banner so the recipient knows which account.
      const banner = regarding
        ? `<p style="margin:0 0 14px;padding:8px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;color:#0f766e;font-size:13px"><strong>Regarding:</strong> ${escapeHtml(regarding)}</p>`
        : '';
      // Use the sanitized rich body for the email so bold/italic/lists/links render;
      // fall back to escaped plain text (e.g. for replies, which are plain).
      const emailBody = banner + (bodyHtml ?? `<p style="white-space:pre-wrap;margin:0">${escapeHtml(preview)}</p>`);
      await this.emailCopy(thread.tenantId, emailTargets, subjectWithClient, emailBody, link);
    }

    // WhatsApp → recorded stub only (no send until a provider is wired). Prefix with the
    // client so the message names the company/person too.
    if (thread.notifyWhatsapp) {
      const mobile = actorIsClient ? '(agency)' : client?.mobile ?? '(no number on file)';
      const waText = regarding ? `[${regarding}] ${title}` : title;
      this.logger.log(`[whatsapp-stub] would notify ${mobile} — "${waText}". Wire WHATSAPP_TOKEN/PHONE_ID to enable.`);
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

// ── attachment decode ──────────────────────────────────────────────────
const ALLOWED_MIME = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_BYTES = 5 * 1024 * 1024;

interface AttachmentInput { attachmentBase64?: string; attachmentName?: string; attachmentMime?: string }

/** Decode + validate an optional base64/data-URL attachment (shared by create & reply). */
function decodeAttachment(dto: AttachmentInput): { data: Buffer; name: string; mime: string } | null {
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
