import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ApprovalEntity,
  ContactStatus,
  MessageDirection,
  MessageStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MailerService } from '../sending/mailer.service';
import { QUEUE_SEND, JOB_RESEND_MESSAGE } from '../queue/queue.constants';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ownedClientIds } from '../common/client-scope';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private mailer: MailerService,
    @Optional() @InjectQueue(QUEUE_SEND) private sendQueue?: Queue,
  ) {}

  private async base(user: AuthUser, where: object, clientId?: string, mailboxId?: string) {
    // Scope to one client = messages either sent through one of its mailboxes
    // or addressed to/from one of its contacts. A client-portal user is always
    // held to their own workspaces.
    const clientScope = await this.scopeFor(user, clientId);
    // Optional single-mailbox filter — the shared inbox aggregates every
    // registered address, so this narrows the view to one mailbox (matched on
    // whichever mailbox sent/received the message).
    const mailboxScope = mailboxId ? { emailAccountId: mailboxId } : {};
    return this.prisma.emailMessage.findMany({
      where: { tenantId: user.tenantId, ...clientScope, ...mailboxScope, ...where },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        contact: { select: { email: true } },
        campaign: { select: { name: true } },
        emailAccount: { select: { id: true, emailAddress: true, label: true } },
      },
    });
  }

  sent(user: AuthUser, clientId?: string, mailboxId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.SENT },
      clientId,
      mailboxId,
    );
  }

  failed(user: AuthUser, clientId?: string, mailboxId?: string) {
    return this.base(
      user,
      {
        direction: MessageDirection.OUTBOUND,
        status: { in: [MessageStatus.FAILED, MessageStatus.BOUNCED] },
      },
      clientId,
      mailboxId,
    );
  }

  scheduled(user: AuthUser, clientId?: string, mailboxId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.QUEUED },
      clientId,
      mailboxId,
    );
  }

  drafts(user: AuthUser, clientId?: string, mailboxId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.DRAFT },
      clientId,
      mailboxId,
    );
  }

  /** Messages of one client — or, for a client-portal user, only their own workspaces. */
  private async scopeFor(user: AuthUser, clientId?: string): Promise<Record<string, unknown>> {
    const owned = await ownedClientIds(this.prisma, user);
    if (owned === null) {
      return clientId ? { OR: [{ emailAccount: { clientId } }, { contact: { clientId } }] } : {};
    }
    const ids = clientId && owned.includes(clientId) ? [clientId] : owned;
    return {
      OR: [{ emailAccount: { clientId: { in: ids } } }, { contact: { clientId: { in: ids } } }],
    };
  }

  /** The workspace a client-portal user may act on (must be theirs); staff pass through. */
  async ownClientParam(user: AuthUser, clientId?: string): Promise<string | undefined> {
    const owned = await ownedClientIds(this.prisma, user);
    if (owned === null) return clientId;
    if (!clientId || !owned.includes(clientId)) throw new NotFoundException('Workspace not found');
    return clientId;
  }

  /** Count of unread inbound replies (optionally for one client) — Inbox badge. */
  async unreadCount(user: AuthUser, clientId?: string) {
    const count = await this.prisma.emailMessage.count({
      where: {
        tenantId: user.tenantId,
        direction: MessageDirection.INBOUND,
        readAt: null,
        ...(await this.scopeFor(user, clientId)),
      },
    });
    return { count };
  }

  /** Mark inbound replies read (optionally for one client) — clears the badge. */
  async markRead(user: AuthUser, clientId?: string) {
    const res = await this.prisma.emailMessage.updateMany({
      where: {
        tenantId: user.tenantId,
        direction: MessageDirection.INBOUND,
        readAt: null,
        ...(await this.scopeFor(user, clientId)),
      },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }

  /**
   * Delete a message. Super admins delete immediately; a sub-admin's delete is
   * submitted for super-admin approval (the message is only removed on approve).
   */
  async remove(user: AuthUser, id: string) {
    const msg = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: user.tenantId, ...(await this.scopeFor(user)) },
      select: { id: true },
    });
    if (!msg) throw new NotFoundException('Message not found');

    if (user.role === Role.SUPER_ADMIN) {
      await this.prisma.emailMessage.delete({ where: { id } });
      return { ok: true, deleted: true };
    }
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.MESSAGE_DELETE,
      entityId: id,
    });
    return { ok: true, pendingApproval: true };
  }

  /** Bulk hard-delete messages (super-admin only; used by the Inbox/Sent bulk
   *  selection). Scoped to the tenant; ignores ids that don't belong to it. */
  async removeMany(user: AuthUser, ids: string[]) {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new BadRequestException('Only a super admin can bulk-delete messages.');
    }
    const clean = [...new Set((ids ?? []).filter(Boolean))];
    if (clean.length === 0) return { deleted: 0 };
    const res = await this.prisma.emailMessage.deleteMany({
      where: { id: { in: clean }, tenantId: user.tenantId },
    });
    return { deleted: res.count };
  }

  /** Re-send one FAILED email now (instant, for the per-row button). */
  async resend(user: AuthUser, id: string): Promise<{ ok: boolean }> {
    const m = await this.loadResendable(id, user.tenantId, await this.scopeFor(user));
    if (m.status !== MessageStatus.FAILED) throw new BadRequestException('Only failed emails can be resent (bounced/sent are not).');
    await this.deliverMessage(user.tenantId, m);
    return { ok: true };
  }

  /** Bulk re-send: queue EVERY failed email to the send worker (background, uncapped). */
  async resendFailed(user: AuthUser, clientId?: string): Promise<{ queued: number }> {
    const clientScope = await this.scopeFor(user, clientId);
    const failed = await this.prisma.emailMessage.findMany({
      where: { tenantId: user.tenantId, status: MessageStatus.FAILED, ...clientScope },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (failed.length === 0) return { queued: 0 };
    // Mark them QUEUED so they leave the Failed tab immediately (a failed retry re-marks FAILED).
    await this.prisma.emailMessage.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { status: MessageStatus.QUEUED, error: null } });
    if (this.sendQueue) {
      // Stagger a few seconds apart so we don't hammer SMTP (worker concurrency also caps it).
      await Promise.all(failed.map((f, i) =>
        this.sendQueue!.add(JOB_RESEND_MESSAGE, { messageId: f.id }, { delay: i * 5_000, removeOnComplete: 1000, removeOnFail: 500 })
          .catch(() => this.resendById(f.id).catch(() => undefined)),
      ));
    } else {
      // No queue (Redis off): send inline, best-effort.
      for (const f of failed) await this.resendById(f.id).catch(() => undefined);
    }
    return { queued: failed.length };
  }

  /** Queue worker entry: re-send one message by id (already marked QUEUED). */
  async resendById(id: string): Promise<void> {
    const m = await this.prisma.emailMessage.findUnique({
      where: { id },
      include: { emailAccount: true, contact: { select: { email: true, status: true } } },
    });
    if (!m) return;
    await this.deliverMessage(m.tenantId, m);
  }

  private loadResendable(id: string, tenantId: string, scope: Record<string, unknown> = {}) {
    return this.prisma.emailMessage
      .findFirst({ where: { id, tenantId, ...scope }, include: { emailAccount: true, contact: { select: { email: true, status: true } } } })
      .then((m) => { if (!m) throw new NotFoundException('Message not found'); return m; });
  }

  /** Validate + send via the mailbox, then mark SENT (or back to FAILED with the error). */
  private async deliverMessage(
    tenantId: string,
    m: { id: string; subject: string | null; body: string | null;
      emailAccount: { emailAddress: string } | null; contact: { email: string | null; status: ContactStatus } | null },
  ): Promise<void> {
    const fail = async (msg: string) => {
      await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: MessageStatus.FAILED, error: msg.slice(0, 500) } }).catch(() => undefined);
      throw new BadRequestException(msg);
    };
    if (!m.emailAccount) return fail('This message has no mailbox to send from.');
    const to = m.contact?.email?.trim();
    if (!to) return fail('No recipient address on this message.');
    if (m.contact?.status === ContactStatus.BOUNCED || m.contact?.status === ContactStatus.UNSUBSCRIBED) {
      return fail('Recipient is bounced/unsubscribed — not resending.');
    }
    const suppressed = await this.prisma.suppression.findFirst({ where: { tenantId, email: to.toLowerCase() }, select: { id: true } });
    if (suppressed) return fail('This address is on the suppression list — not resending.');
    try {
      await this.mailer.send({ account: m.emailAccount as never, to, subject: m.subject ?? '', html: m.body ?? '' });
      await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: MessageStatus.SENT, sentAt: new Date(), error: null } });
    } catch (err) {
      await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: MessageStatus.FAILED, error: String((err as Error)?.message || err).slice(0, 500) } });
      throw new BadRequestException(`Resend failed: ${String((err as Error)?.message || err).slice(0, 200)}`);
    }
  }

  async inbox(user: AuthUser, clientId?: string, mailboxId?: string) {
    const rows = await this.base(
      user,
      { direction: MessageDirection.INBOUND },
      clientId,
      mailboxId,
    );
    // Newest-received first, by the real email date (sentAt) when we captured
    // it, else by when we stored it.
    return rows.sort((a, b) => {
      const at = (a.sentAt ?? a.createdAt).getTime();
      const bt = (b.sentAt ?? b.createdAt).getTime();
      return bt - at;
    });
  }
}
