import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class CreditsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  /** Returns the user's credit account, creating an empty one on first read. */
  async get(tenantId: string, userId: string) {
    const existing = await this.prisma.creditAccount.findUnique({
      where: { userId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (existing) return existing;
    return this.prisma.creditAccount.create({
      data: { tenantId, userId },
      include: { transactions: true },
    });
  }

  /** Admin grants (delta > 0) or deducts (delta < 0) credits. */
  async adjust(
    actor: AuthUser,
    userId: string,
    delta: number,
    reason: string,
  ) {
    const account = await this.get(actor.tenantId, userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const acc = await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: { increment: delta } },
      });
      await tx.creditTransaction.create({
        data: { creditAccountId: account.id, delta, reason },
      });
      return acc;
    });
    await this.activity.log({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'ADJUST_CREDITS',
      entityType: 'CreditAccount',
      entityId: account.id,
      after: { delta, reason, balance: updated.balance },
    });
    return updated;
  }
}
