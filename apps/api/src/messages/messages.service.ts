import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  private base(user: AuthUser, where: object) {
    return this.prisma.emailMessage.findMany({
      where: { tenantId: user.tenantId, ...where },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        contact: { select: { email: true } },
        campaign: { select: { name: true } },
      },
    });
  }

  sent(user: AuthUser) {
    return this.base(user, {
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT,
    });
  }

  failed(user: AuthUser) {
    return this.base(user, {
      direction: MessageDirection.OUTBOUND,
      status: { in: [MessageStatus.FAILED, MessageStatus.BOUNCED] },
    });
  }

  scheduled(user: AuthUser) {
    return this.base(user, {
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.QUEUED,
    });
  }

  drafts(user: AuthUser) {
    return this.base(user, {
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.DRAFT,
    });
  }

  inbox(user: AuthUser) {
    return this.base(user, { direction: MessageDirection.INBOUND });
  }
}
