import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InternalNoteAudience, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateInternalNoteDto } from './dto/internal-work.dto';

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
    await this.assertDraft(actor.tenantId, id);
    const data = await this.composeData(actor, dto);
    await this.prisma.internalNote.update({ where: { id }, data });
    return { id };
  }

  async postDraft(actor: AuthUser, id: string) {
    await this.assertDraft(actor.tenantId, id);
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
    await this.prisma.internalNote.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────────────────────── read ───────────────────────────

  /** The board: everything posted in this workspace, plus the author's own drafts. */
  list(user: AuthUser, clientId?: string) {
    return this.prisma.internalNote.findMany({
      where: {
        tenantId: user.tenantId,
        ...(clientId ? { clientId } : {}),
        // Drafts stay private to whoever wrote them; posted notes are shared.
        OR: [{ status: 'POSTED' }, { status: 'DRAFT', createdByUserId: user.userId }],
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
    const n = await this.prisma.internalNote.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!n) throw new NotFoundException('Note not found');
    if (n.status === 'DRAFT' && n.createdByUserId !== user.userId) {
      throw new NotFoundException('Note not found');
    }
    // Opening it clears the reader's unread marker.
    await this.prisma.internalNoteRecipient.updateMany({
      where: { noteId: id, userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return n;
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.internalNoteRecipient.count({
      where: { userId: user.userId, readAt: null },
    });
    return { count };
  }

  /** Admins + sub-admins, for the "share with" picker. */
  staff(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
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
    if (dto.audience === 'USER') {
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
        where: { id: n.targetUserId, tenantId: n.tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] } },
        select: { id: true },
      });
      if (!t) throw new BadRequestException('That person is not an admin or sub-admin.');
      userIds = [t.id];
    } else {
      const staff = await this.prisma.user.findMany({
        where: { tenantId: n.tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
        select: { id: true },
      });
      userIds = staff.map((s) => s.id);
    }
    // Don't nag the author about their own note.
    userIds = userIds.filter((id) => id !== actor.userId);
    if (userIds.length === 0) return 0;

    await this.prisma.internalNoteRecipient.createMany({
      data: userIds.map((userId) => ({ noteId, userId })),
      skipDuplicates: true,
    });
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

  private async assertDraft(tenantId: string, id: string) {
    const n = await this.prisma.internalNote.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!n) throw new NotFoundException('Note not found');
    if (n.status !== 'DRAFT') throw new BadRequestException('This note was already posted.');
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
