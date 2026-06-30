import { Injectable } from '@nestjs/common';
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

  inbox(user: AuthUser, clientId?: string) {
    return this.base(user, { direction: MessageDirection.INBOUND }, clientId);
  }
}
