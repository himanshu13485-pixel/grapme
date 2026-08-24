import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BroadcastAudience, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateBroadcastDto } from './dto/broadcasts.dto';

/** The subset of audience fields needed to resolve recipients (from a DTO or a row). */
interface AudienceSpec {
  audience: string;
  channel?: string | null;
  plan?: string | null;
  clientId?: string | null;
}

@Injectable()
export class BroadcastsService {
  constructor(
    private prisma: PrismaService,
    private notify: NotifyService,
    private activity: ActivityService,
  ) {}

  // ─────────────────────────── Admin: compose ───────────────────────────

  /** Compose + deliver a broadcast immediately. */
  async create(actor: AuthUser, dto: CreateBroadcastDto) {
    const data = await this.composeData(actor, dto);
    const broadcast = await this.prisma.broadcast.create({
      data: { ...data, status: 'SENT', sentAt: new Date() },
      select: { id: true },
    });
    const count = await this.deliver(actor, broadcast.id);
    await this.prisma.broadcast.update({ where: { id: broadcast.id }, data: { recipientCount: count } });
    await this.log(actor, broadcast.id, 'SEND_BROADCAST', { audience: dto.audience, recipients: count });
    return { id: broadcast.id, recipientCount: count };
  }

  /** Save a broadcast as a draft — no recipients resolved, nothing sent. */
  async saveDraft(actor: AuthUser, dto: CreateBroadcastDto) {
    const data = await this.composeData(actor, dto);
    const broadcast = await this.prisma.broadcast.create({
      data: { ...data, status: 'DRAFT' },
      select: { id: true },
    });
    await this.log(actor, broadcast.id, 'SAVE_BROADCAST_DRAFT', { audience: dto.audience });
    return { id: broadcast.id };
  }

  /** Update an existing draft (cannot edit an already-sent broadcast). */
  async updateDraft(actor: AuthUser, id: string, dto: CreateBroadcastDto) {
    await this.assertDraft(actor.tenantId, id);
    const data = await this.composeData(actor, dto);
    await this.prisma.broadcast.update({ where: { id }, data });
    return { id };
  }

  /** Send a saved draft to its audience. */
  async sendDraft(actor: AuthUser, id: string) {
    await this.assertDraft(actor.tenantId, id);
    const count = await this.deliver(actor, id);
    await this.prisma.broadcast.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), recipientCount: count },
    });
    await this.log(actor, id, 'SEND_BROADCAST', { recipients: count });
    return { id, recipientCount: count };
  }

  /** Delete a draft (sent broadcasts are kept as an audit record). */
  async deleteDraft(actor: AuthUser, id: string) {
    await this.assertDraft(actor.tenantId, id);
    await this.prisma.broadcast.delete({ where: { id } });
    return { ok: true };
  }

  /** Recent broadcasts + drafts (newest activity first). */
  list(tenantId: string) {
    return this.prisma.broadcast.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        audienceLabel: true,
        showInApp: true,
        sendEmail: true,
        sendWhatsapp: true,
        sendTelegram: true,
        sendNetvork: true,
        recipientCount: true,
        createdByName: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Full broadcast (for loading a draft into the editor). */
  async getOne(tenantId: string, id: string) {
    const b = await this.prisma.broadcast.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Broadcast not found');
    return b;
  }

  // ─────────────────────────── Client portal ───────────────────────────

  async listMine(user: AuthUser) {
    const rows = await this.prisma.broadcastRecipient.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        readAt: true,
        broadcast: {
          select: { id: true, title: true, bodyHtml: true, signatureHtml: true, createdByName: true, createdAt: true },
        },
      },
    });
    return rows.map((r) => ({
      recipientId: r.id,
      read: !!r.readAt,
      id: r.broadcast.id,
      title: r.broadcast.title,
      bodyHtml: r.broadcast.bodyHtml,
      signatureHtml: r.broadcast.signatureHtml,
      from: r.broadcast.createdByName,
      createdAt: r.broadcast.createdAt,
    }));
  }

  async markRead(user: AuthUser, recipientId: string) {
    const res = await this.prisma.broadcastRecipient.updateMany({
      where: { id: recipientId, userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.broadcastRecipient.findFirst({
        where: { id: recipientId, userId: user.userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.broadcastRecipient.count({
      where: { userId: user.userId, readAt: null },
    });
    return { count };
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Build the persisted columns shared by create / draft / update. */
  private async composeData(actor: AuthUser, dto: CreateBroadcastDto) {
    const createdByName = await this.prisma.user
      .findUnique({ where: { id: actor.userId }, select: { name: true } })
      .then((u) => u?.name ?? null);
    return {
      tenantId: actor.tenantId,
      title: dto.title.trim(),
      bodyHtml: dto.bodyHtml,
      signatureHtml: dto.signatureHtml?.trim() || null,
      audience: dto.audience as BroadcastAudience,
      channel: dto.audience === 'CHANNEL' ? dto.channel ?? null : null,
      plan: dto.audience === 'PLAN' ? dto.plan ?? null : null,
      clientId: dto.audience === 'CLIENT' ? dto.clientId ?? null : null,
      audienceLabel: await this.computeLabel(actor.tenantId, dto),
      showInApp: dto.showInApp ?? true,
      sendEmail: dto.sendEmail ?? true,
      sendWhatsapp: dto.sendWhatsapp ?? false,
      sendTelegram: dto.sendTelegram ?? false,
      sendNetvork: dto.sendNetvork ?? false,
      createdByUserId: actor.userId,
      createdByName,
    };
  }

  /** Resolve the audience for a stored broadcast, create recipient rows, and fan out. */
  private async deliver(actor: AuthUser, broadcastId: string): Promise<number> {
    const b = await this.prisma.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
    const clients = await this.resolveAudience(actor.tenantId, b);

    const byUser = new Map<string, string>(); // ownerUserId -> representative clientId
    for (const c of clients) {
      if (c.ownerUserId && !byUser.has(c.ownerUserId)) byUser.set(c.ownerUserId, c.id);
    }
    const recipientUserIds = [...byUser.keys()];
    if (recipientUserIds.length) {
      await this.prisma.broadcastRecipient.createMany({
        data: [...byUser.entries()].map(([userId, clientId]) => ({ broadcastId, userId, clientId })),
      });
    }

    const emailHtml = b.signatureHtml
      ? `${b.bodyHtml}<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0" />${b.signatureHtml}`
      : b.bodyHtml;
    await this.notify.notifyMany(
      recipientUserIds,
      { type: 'broadcast', title: b.title, body: htmlToText(b.bodyHtml), link: '/notifications', emailHtml },
      // Every channel named, none inherited. Left unsaid, netvork would
      // follow `whatsapp` — see NotifyChannels — and a broadcast marked for
      // WhatsApp would quietly go out on Netvork too.
      {
        inApp: b.showInApp,
        email: b.sendEmail,
        whatsapp: b.sendWhatsapp,
        telegram: b.sendTelegram,
        netvork: b.sendNetvork,
      },
    );
    return recipientUserIds.length;
  }

  private async resolveAudience(tenantId: string, spec: AudienceSpec) {
    const base: Prisma.ClientWhereInput = { tenantId, ownerUserId: { not: null } };
    let where: Prisma.ClientWhereInput = base;

    if (spec.audience === 'CHANNEL') {
      if (!spec.channel) throw new BadRequestException('Choose Email or LinkedIn clients.');
      where = spec.channel === 'EMAIL' ? { ...base, emailEnabled: true } : { ...base, linkedInEnabled: true };
    } else if (spec.audience === 'PLAN') {
      if (!spec.plan) throw new BadRequestException('Choose a plan.');
      where = { ...base, plan: spec.plan };
    } else if (spec.audience === 'CLIENT') {
      if (!spec.clientId) throw new BadRequestException('Choose a client.');
      const client = await this.prisma.client.findFirst({
        where: { id: spec.clientId, tenantId },
        select: { id: true, ownerUserId: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      if (!client.ownerUserId) throw new BadRequestException('That client has no portal login to notify.');
      return [client];
    }
    return this.prisma.client.findMany({ where, select: { id: true, ownerUserId: true } });
  }

  /** Lenient human label for the list (does not validate — safe for drafts). */
  private async computeLabel(tenantId: string, spec: AudienceSpec): Promise<string> {
    if (spec.audience === 'CHANNEL') return spec.channel === 'LINKEDIN' ? 'LinkedIn clients' : 'Email clients';
    if (spec.audience === 'PLAN') return spec.plan ? `Plan: ${spec.plan}` : 'Plan';
    if (spec.audience === 'CLIENT') {
      if (!spec.clientId) return 'Specific client';
      const c = await this.prisma.client.findFirst({ where: { id: spec.clientId, tenantId }, select: { name: true } });
      return c ? `Client: ${c.name}` : 'Specific client';
    }
    return 'All clients';
  }

  private async assertDraft(tenantId: string, id: string) {
    const b = await this.prisma.broadcast.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!b) throw new NotFoundException('Broadcast not found');
    if (b.status !== 'DRAFT') throw new BadRequestException('This broadcast was already sent.');
    return b;
  }

  private log(actor: AuthUser, entityId: string, action: string, after: Record<string, unknown>) {
    return this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action,
      entityType: 'Broadcast',
      entityId,
      after,
    });
  }
}

/** Cheap HTML → text for the bell preview / plain fallback. */
function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
