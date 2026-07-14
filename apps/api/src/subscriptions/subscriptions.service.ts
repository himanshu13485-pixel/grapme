import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type SubStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED';

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER];
const EXPIRING_DAYS = 7;

/** Subscription renewal history: one SubscriptionPeriod per plan/validity window. */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a new subscription period for a client. If a period is still open (running
   * to a future expiry), it's closed early as SUPERSEDED. No window (0/null days) = no-op.
   */
  async record(
    tenantId: string,
    clientId: string,
    opts: { plan?: string | null; validityDays: number | null; amount?: number | null; currency?: string | null; source?: string },
  ) {
    if (!opts.validityDays || opts.validityDays <= 0) return null;
    const now = new Date();
    const endAt = new Date(now.getTime() + opts.validityDays * 86_400_000);
    const open = await this.prisma.subscriptionPeriod.findFirst({
      where: { clientId, endedReason: null, endAt: { gt: now } },
      orderBy: { startAt: 'desc' },
    });
    if (open) {
      await this.prisma.subscriptionPeriod.update({ where: { id: open.id }, data: { endAt: now, endedReason: 'SUPERSEDED' } });
    }
    return this.prisma.subscriptionPeriod.create({
      data: {
        tenantId, clientId,
        plan: opts.plan || '—',
        validityDays: opts.validityDays,
        startAt: now, endAt,
        amount: opts.amount ?? null,
        currency: opts.currency ?? null,
        source: opts.source ?? 'admin',
      },
    });
  }

  private status(endAt: Date, endedReason: string | null, now: number): SubStatus {
    if (endedReason === 'SUPERSEDED') return 'SUPERSEDED';
    if (endedReason === 'CANCELLED') return 'CANCELLED';
    const end = new Date(endAt).getTime();
    if (end <= now) return 'EXPIRED';
    return Math.ceil((end - now) / 86_400_000) <= EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE';
  }

  /** Access-checked history for a client (newest first) with computed status + days-left. */
  async historyForClient(user: AuthUser, clientId: string) {
    const where = ADMIN_ROLES.includes(user.role as Role)
      ? { id: clientId, tenantId: user.tenantId }
      : { id: clientId, ownerUserId: user.userId };
    const ok = await this.prisma.client.count({ where });
    if (!ok) throw new ForbiddenException('You do not have access to this client');

    const rows = await this.prisma.subscriptionPeriod.findMany({ where: { clientId }, orderBy: { startAt: 'desc' } });
    const now = Date.now();
    const items = rows.map((r, i) => ({
      id: r.id,
      plan: r.plan,
      validityDays: r.validityDays,
      startAt: r.startAt,
      endAt: r.endAt,
      amount: r.amount,
      currency: r.currency,
      source: r.source,
      endedReason: r.endedReason,
      current: i === 0 && r.endedReason == null,
      status: this.status(r.endAt, r.endedReason, now),
      daysLeft: Math.ceil((new Date(r.endAt).getTime() - now) / 86_400_000),
    }));
    return { clientId, items };
  }
}
