import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

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

  /** Delete a message (must belong to the caller's tenant). Events cascade. */
  async remove(user: AuthUser, id: string) {
    const msg = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!msg) throw new NotFoundException('Message not found');
    await this.prisma.emailMessage.delete({ where: { id } });
    return { ok: true };
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
