import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InternalNoteAudience, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateInternalNoteDto } from './dto/internal-work.dto';

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN];
const STAFF_ROLES: Role[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES];

/**
 * Internal Work — the agency's private board. Notes and discussion about a client
 * between admins and sub-admins. Same composer shape as an admin Broadcast (title,
 * rich body, drafts, in-app/email), but the audience is STAFF only: nothing here is
 * ever exposed to a client, and the controller is gated to admin roles.
 */
@Injectable()
export class InternalWorkService {
  constructor(
    private prisma: PrismaService,
    private notify: NotifyService,
    private activity: ActivityService,
  ) {}

  // ─────────────────────────── compose ───────────────────────────

  /** Post a note now (share + notify). */
  async create(actor: AuthUser, dto: CreateInternalNoteDto) {
    const data = await this.composeData(actor, dto);
    const note = await this.prisma.internalNote.create({
      data: { ...data, status: 'POSTED', postedAt: new Date() },
      select: { id: true },
    });
    const count = await this.deliver(actor, note.id);
    await this.prisma.internalNote.update({ where: { id: note.id }, data: { recipientCount: count } });
    await this.log(actor, note.id, 'POST_INTERNAL_NOTE', { audience: dto.audience, recipients: count });
    return { id: note.id, recipientCount: count };
  }

  /** Save without sharing. */
  async saveDraft(actor: AuthUser, dto: CreateInternalNoteDto) {
    const data = await this.composeData(actor, dto);
    const note = await this.prisma.internalNote.create({ data: { ...data, status: 'DRAFT' }, select: { id: true } });
    return { id: note.id };
  }

  async updateDraft(actor: AuthUser, id: string, dto: CreateInternalNoteDto) {
    await this.assertDraft(actor, id);
    const data = await this.composeData(actor, dto);
    await this.prisma.internalNote.update({ where: { id }, data });
    return { id };
  }

  async postDraft(actor: AuthUser, id: string) {
    await this.assertDraft(actor, id);
    const count = await this.deliver(actor, id);
    await this.prisma.internalNote.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), recipientCount: count },
    });
    await this.log(actor, id, 'POST_INTERNAL_NOTE', { recipients: count });
    return { id, recipientCount: count };
  }

  async remove(actor: AuthUser, id: string) {
    const n = await this.prisma.internalNote.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true } });
    if (!n) throw new NotFoundException('Note not found');
    // Delete is gated by delete rights: super admin always; sub-admin only with full
    // access or the delete flag; salespersons never.
    await this.assertCanDelete(actor);
    await this.prisma.internalNote.delete({ where: { id } });
    return { ok: true };
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

  // ─────────────────────────── read ───────────────────────────

  /** The board. Admins see the whole internal board; a salesperson sees only notes
   *  they authored or were shared with. Drafts stay private to their author. */
  list(user: AuthUser, clientId?: string) {
    const isAdmin = ADMIN_ROLES.includes(user.role as Role);
    // Posted notes visible to this user.
    const postedVisible = isAdmin
      ? { status: 'POSTED' as const }
      : { status: 'POSTED' as const, OR: [{ createdByUserId: user.userId }, { recipients: { some: { userId: user.userId } } }] };
    return this.prisma.internalNote.findMany({
      where: {
        tenantId: user.tenantId,
        ...(clientId ? { clientId } : {}),
        OR: [postedVisible, { status: 'DRAFT', createdByUserId: user.userId }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true, title: true, status: true, clientId: true, clientName: true,
        audienceLabel: true, showInApp: true, sendEmail: true, recipientCount: true,
        createdByUserId: true, createdByName: true, postedAt: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const n = await this.prisma.internalNote.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        recipients: { select: { userId: true, seenAt: true, user: { select: { name: true, email: true, role: true } } } },
      },
    });
    if (!n) throw new NotFoundException('Note not found');
    if (n.status === 'DRAFT' && n.createdByUserId !== user.userId) throw new NotFoundException('Note not found');
    // Salespersons may only open notes they authored or were shared with.
    if (!ADMIN_ROLES.includes(user.role as Role)) {
      const isParticipant = n.createdByUserId === user.userId || n.recipients.some((r) => r.userId === user.userId);
      if (!isParticipant) throw new NotFoundException('Note not found');
    }
    // Opening it clears the reader's unread marker AND advances their monotonic
    // last-seen time (for the "seen by" receipts). Ensure the viewer has a row.
    const now = new Date();
    const touched = await this.prisma.internalNoteRecipient.updateMany({
      where: { noteId: id, userId: user.userId },
      data: { readAt: now, seenAt: now },
    });
    if (touched.count === 0) {
      await this.prisma.internalNoteRecipient.create({ data: { noteId: id, userId: user.userId, readAt: now, seenAt: now } }).catch(() => undefined);
    }

    // Build the reader roster (dedup by user, keep latest seen), then attach the
    // list of who had seen each message by the time they last opened it.
    const readers = new Map<string, { userId: string; name: string; role: Role; seenAt: Date }>();
    for (const r of n.recipients) {
      const seen = r.userId === user.userId ? now : r.seenAt; // reflect this open immediately
      if (!seen) continue;
      const prev = readers.get(r.userId);
      if (!prev || prev.seenAt < seen) {
        readers.set(r.userId, { userId: r.userId, name: r.user?.name ?? r.user?.email ?? 'Someone', role: r.user?.role as Role, seenAt: seen });
      }
    }
    const seenByAt = (at: Date, authorUserId: string) =>
      [...readers.values()]
        .filter((r) => r.userId !== authorUserId && r.seenAt >= at)
        .map((r) => ({ userId: r.userId, name: r.name, role: r.role, at: r.seenAt }));

    const { recipients, messages, ...rest } = n;
    return {
      ...rest,
      seenBy: seenByAt(n.createdAt, n.createdByUserId), // for the opening post
      messages: messages.map((m) => ({ ...m, seenBy: seenByAt(m.createdAt, m.userId) })),
    };
  }

  /** Post a chat reply into a note's thread and alert the other participants. */
  async addMessage(user: AuthUser, id: string, body: string) {
    const n = await this.prisma.internalNote.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, title: true, clientName: true, status: true, createdByUserId: true, showInApp: true, recipients: { select: { userId: true } } },
    });
    if (!n) throw new NotFoundException('Note not found');
    if (n.status !== 'POSTED') throw new BadRequestException('Post the note before chatting on it.');
    const participants = new Set<string>([n.createdByUserId, ...n.recipients.map((r) => r.userId)]);
    const isAdmin = ADMIN_ROLES.includes(user.role as Role);
    if (!isAdmin && !participants.has(user.userId)) throw new ForbiddenException('You are not part of this discussion');

    const authorName = await this.prisma.user
      .findUnique({ where: { id: user.userId }, select: { name: true, email: true } })
      .then((u) => u?.name ?? u?.email ?? 'Someone');
    const trimmed = body.trim();
    const message = await this.prisma.internalNoteMessage.create({
      data: { noteId: id, userId: user.userId, authorName, body: trimmed },
    });
    // An admin replying joins the thread as a participant so they keep getting alerts.
    if (isAdmin && !participants.has(user.userId)) {
      await this.prisma.internalNoteRecipient.create({ data: { noteId: id, userId: user.userId, readAt: new Date() } }).catch(() => undefined);
      participants.add(user.userId);
    }
    await this.prisma.internalNote.update({ where: { id }, data: { updatedAt: new Date() } });

    // Alert every other participant (mark their unread + bell/email per the note's setting).
    const others = [...participants].filter((uid) => uid !== user.userId);
    if (others.length) {
      // Ensure everyone has a row (e.g. the author, who has no recipient row by default),
      // then flag them all unread so the nav badge lights for them.
      await this.prisma.internalNoteRecipient.createMany({
        data: others.map((userId) => ({ noteId: id, userId })),
        skipDuplicates: true,
      });
      await this.prisma.internalNoteRecipient.updateMany({ where: { noteId: id, userId: { in: others } }, data: { readAt: null } });
      await this.notify.notifyMany(
        others,
        {
          type: 'internal-work',
          title: n.clientName ? `${n.title} — ${n.clientName}` : n.title,
          body: `${authorName}: ${trimmed}`.slice(0, 280),
          link: `/internal-work?note=${id}`,
        },
        { inApp: n.showInApp, email: false, whatsapp: false },
      );
    }
    return message;
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.internalNoteRecipient.count({
      where: { userId: user.userId, readAt: null },
    });
    return { count };
  }

  /** Admins, sub-admins + salespersons, for the "share with" picker. */
  staff(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId, role: { in: STAFF_ROLES }, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async composeData(actor: AuthUser, dto: CreateInternalNoteDto) {
    const createdByName = await this.prisma.user
      .findUnique({ where: { id: actor.userId }, select: { name: true } })
      .then((u) => u?.name ?? null);
    const client = dto.clientId
      ? await this.prisma.client.findFirst({ where: { id: dto.clientId, tenantId: actor.tenantId }, select: { id: true, name: true } })
      : null;
    let audienceLabel = 'All admins & sub-admins';
    if (dto.audience === 'ALL_STAFF_SALES') {
      audienceLabel = 'All admins, sub-admins & salespersons';
    } else if (dto.audience === 'USER') {
      const t = dto.targetUserId
        ? await this.prisma.user.findFirst({ where: { id: dto.targetUserId, tenantId: actor.tenantId }, select: { name: true, email: true } })
        : null;
      audienceLabel = t ? `${t.name || t.email}` : 'Specific person';
    }
    return {
      tenantId: actor.tenantId,
      title: dto.title.trim(),
      bodyHtml: dto.bodyHtml,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      audience: dto.audience as InternalNoteAudience,
      targetUserId: dto.audience === 'USER' ? dto.targetUserId ?? null : null,
      audienceLabel,
      showInApp: dto.showInApp ?? true,
      sendEmail: dto.sendEmail ?? false,
      createdByUserId: actor.userId,
      createdByName,
    };
  }

  /** Resolve the staff recipients, record them, and fan out (best-effort). */
  private async deliver(actor: AuthUser, noteId: string): Promise<number> {
    const n = await this.prisma.internalNote.findUniqueOrThrow({ where: { id: noteId } });

    let userIds: string[] = [];
    if (n.audience === 'USER') {
      if (!n.targetUserId) throw new BadRequestException('Choose who to share this with.');
      const t = await this.prisma.user.findFirst({
        where: { id: n.targetUserId, tenantId: n.tenantId, role: { in: STAFF_ROLES } },
        select: { id: true },
      });
      if (!t) throw new BadRequestException('That person is not a staff member.');
      userIds = [t.id];
    } else {
      // ALL_STAFF = admins + sub-admins; ALL_STAFF_SALES also includes salespersons.
      const roles = n.audience === 'ALL_STAFF_SALES' ? STAFF_ROLES : ADMIN_ROLES;
      const staff = await this.prisma.user.findMany({
        where: { tenantId: n.tenantId, role: { in: roles }, status: 'ACTIVE' },
        select: { id: true },
      });
      userIds = staff.map((s) => s.id);
    }
    // The author is always a participant, but don't nag them about their own note.
    userIds = userIds.filter((id) => id !== actor.userId);

    await this.prisma.internalNoteRecipient.createMany({
      data: userIds.map((userId) => ({ noteId, userId })),
      skipDuplicates: true,
    });
    // Give the author a (pre-read) row too, so a later reply can flag THEM unread
    // (the badge fix: the author is a first-class participant, not just the sender).
    await this.prisma.internalNoteRecipient.createMany({
      data: [{ noteId, userId: actor.userId, readAt: new Date() }],
      skipDuplicates: true,
    });
    if (userIds.length === 0) return 0;
    await this.notify.notifyMany(
      userIds,
      {
        type: 'internal-work',
        title: n.clientName ? `${n.title} — ${n.clientName}` : n.title,
        body: htmlToText(n.bodyHtml),
        link: `/internal-work?note=${n.id}`,
        emailHtml: n.bodyHtml,
      },
      { inApp: n.showInApp, email: n.sendEmail, whatsapp: false },
    );
    return userIds.length;
  }

  private async assertDraft(actor: AuthUser, id: string) {
    const n = await this.prisma.internalNote.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, status: true, createdByUserId: true } });
    if (!n) throw new NotFoundException('Note not found');
    if (n.status !== 'DRAFT') throw new BadRequestException('This note was already posted.');
    if (n.createdByUserId !== actor.userId && !ADMIN_ROLES.includes(actor.role as Role)) {
      throw new ForbiddenException('You can only edit your own drafts');
    }
    return n;
  }

  private log(actor: AuthUser, entityId: string, action: string, after: Record<string, unknown>) {
    return this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action,
      entityType: 'InternalNote',
      entityId,
      after,
    });
  }
}

function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
