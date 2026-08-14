import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private mailer: MailerService,
  ) {}

  private base(user: AuthUser, where: object, clientId?: string) {
    // Scope to one client = messages either sent through one of its mailboxes
    // or addressed to/from one of its contacts.
    const clientScope = clientId
      ? {
          OR: [
            { emailAccount: { clientId } },
            { contact: { clientId } },
          ],
        }
      : {};
    return this.prisma.emailMessage.findMany({
      where: { tenantId: user.tenantId, ...clientScope, ...where },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        contact: { select: { email: true } },
        campaign: { select: { name: true } },
        emailAccount: { select: { emailAddress: true, label: true } },
      },
    });
  }

  sent(user: AuthUser, clientId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.SENT },
      clientId,
    );
  }

  failed(user: AuthUser, clientId?: string) {
    return this.base(
      user,
      {
        direction: MessageDirection.OUTBOUND,
        status: { in: [MessageStatus.FAILED, MessageStatus.BOUNCED] },
      },
      clientId,
    );
  }

  scheduled(user: AuthUser, clientId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.QUEUED },
      clientId,
    );
  }

  drafts(user: AuthUser, clientId?: string) {
    return this.base(
      user,
      { direction: MessageDirection.OUTBOUND, status: MessageStatus.DRAFT },
      clientId,
    );
  }

  private clientScope(clientId?: string) {
    return clientId
      ? { OR: [{ emailAccount: { clientId } }, { contact: { clientId } }] }
      : {};
  }

  /** Count of unread inbound replies (optionally for one client) — Inbox badge. */
  async unreadCount(user: AuthUser, clientId?: string) {
    const count = await this.prisma.emailMessage.count({
      where: {
        tenantId: user.tenantId,
        direction: MessageDirection.INBOUND,
        readAt: null,
        ...this.clientScope(clientId),
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
        ...this.clientScope(clientId),
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
      where: { id, tenantId: user.tenantId },
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

  /** Re-send one FAILED email (SMTP send error). Bounced/suppressed addresses are refused. */
  async resend(user: AuthUser, id: string): Promise<{ ok: boolean }> {
    const m = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { emailAccount: true, contact: { select: { email: true, status: true } } },
    });
    if (!m) throw new NotFoundException('Message not found');
    await this.resendOne(user.tenantId, m);
    return { ok: true };
  }

  /** Bulk re-send: retry FAILED emails (capped per call so the request stays snappy). */
  async resendFailed(user: AuthUser, clientId?: string): Promise<{ attempted: number; sent: number; skipped: number }> {
    const clientScope = clientId ? { OR: [{ emailAccount: { clientId } }, { contact: { clientId } }] } : {};
    const failed = await this.prisma.emailMessage.findMany({
      where: { tenantId: user.tenantId, status: MessageStatus.FAILED, ...clientScope },
      orderBy: { createdAt: 'desc' },
      take: 25, // cap per call — click again to continue
      include: { emailAccount: true, contact: { select: { email: true, status: true } } },
    });
    let sent = 0, skipped = 0;
    for (const m of failed) {
      try { await this.resendOne(user.tenantId, m); sent += 1; }
      catch { skipped += 1; }
    }
    return { attempted: failed.length, sent, skipped };
  }

  /** Shared resend: validate + send via the mailbox, then mark SENT / keep the error. */
  private async resendOne(
    tenantId: string,
    m: { id: string; status: MessageStatus; subject: string | null; body: string | null;
      emailAccount: { emailAddress: string } | null; contact: { email: string | null; status: ContactStatus } | null },
  ): Promise<void> {
    if (m.status !== MessageStatus.FAILED) throw new BadRequestException('Only failed emails can be resent (bounced/sent are not).');
    if (!m.emailAccount) throw new BadRequestException('This message has no mailbox to send from.');
    const to = m.contact?.email?.trim();
    if (!to) throw new BadRequestException('No recipient address on this message.');
    if (m.contact?.status === ContactStatus.BOUNCED || m.contact?.status === ContactStatus.UNSUBSCRIBED) {
      throw new BadRequestException('Recipient is bounced/unsubscribed — not resending.');
    }
    const suppressed = await this.prisma.suppression.findFirst({ where: { tenantId, email: to.toLowerCase() }, select: { id: true } });
    if (suppressed) throw new BadRequestException('This address is on the suppression list — not resending.');
    try {
      await this.mailer.send({ account: m.emailAccount as never, to, subject: m.subject ?? '', html: m.body ?? '' });
      await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: MessageStatus.SENT, sentAt: new Date(), error: null } });
    } catch (err) {
      await this.prisma.emailMessage.update({ where: { id: m.id }, data: { error: String((err as Error)?.message || err).slice(0, 500) } });
      throw new BadRequestException(`Resend failed: ${String((err as Error)?.message || err).slice(0, 200)}`);
    }
  }

  async inbox(user: AuthUser, clientId?: string) {
    const rows = await this.base(
      user,
      { direction: MessageDirection.INBOUND },
      clientId,
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
