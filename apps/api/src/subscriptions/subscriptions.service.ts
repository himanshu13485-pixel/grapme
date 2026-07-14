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
    opts: { plan?: string | null; validityDays: number | null; amount?: number | null; currency?: string | null; source?: string; endAt?: Date | null },
  ) {
    if (!opts.validityDays || opts.validityDays <= 0) return null;
    const now = new Date();
    // A fresh window ends now + validityDays; a mid-window plan change passes the
    // existing expiry so the new plan just runs to the same end.
    const endAt = opts.endAt && opts.endAt > now ? opts.endAt : new Date(now.getTime() + opts.validityDays * 86_400_000);
    const open = await this.prisma.subscriptionPeriod.findFirst({
      where: { clientId, endedReason: null, endAt: { gt: now } },
      orderBy: { startAt: 'desc' },
    });
    if (open) {
      await this.prisma.subscriptionPeriod.update({ where: { id: open.id }, data: { endAt: now, endedReason: 'SUPERSEDED' } });
    }
    // Snapshot what this plan includes + the client's invoice number, so the history
    // stays accurate even if the plan definition or invoice changes later.
    const [entitlements, client] = await Promise.all([
      this.planEntitlements(tenantId, opts.plan),
      this.prisma.client.findUnique({ where: { id: clientId }, select: { invoiceNo: true } }),
    ]);
    return this.prisma.subscriptionPeriod.create({
      data: {
        tenantId, clientId,
        plan: opts.plan || '—',
        validityDays: opts.validityDays,
        startAt: now, endAt,
        amount: opts.amount ?? null,
        currency: opts.currency ?? null,
        invoiceNo: client?.invoiceNo ?? null,
        source: opts.source ?? 'admin',
        ...(entitlements ? { entitlements } : {}),
      },
    });
  }

  private async planEntitlements(tenantId: string, planName?: string | null) {
    if (!planName) return null;
    const p = await this.prisma.plan.findFirst({
      where: { tenantId, name: planName },
      select: { emailCredits: true, linkedInCredits: true, mailboxLimit: true, seatLimit: true, emailCampaignLimit: true, linkedInCampaignLimit: true },
    });
    return p ?? null;
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
    // Current invoice for periods that predate the snapshot column.
    const clientRow = await this.prisma.client.findUnique({ where: { id: clientId }, select: { invoiceNo: true } });
    // Fallback entitlements for older/backfilled periods with no snapshot: the plan's
    // current definition (looked up by name).
    const planNames = [...new Set(rows.filter((r) => !r.entitlements).map((r) => r.plan))];
    const plans = planNames.length
      ? await this.prisma.plan.findMany({
          where: { tenantId: user.tenantId, name: { in: planNames } },
          select: { name: true, emailCredits: true, linkedInCredits: true, mailboxLimit: true, seatLimit: true, emailCampaignLimit: true, linkedInCampaignLimit: true },
        })
      : [];
    const planMap = new Map(plans.map((p) => [p.name, { emailCredits: p.emailCredits, linkedInCredits: p.linkedInCredits, mailboxLimit: p.mailboxLimit, seatLimit: p.seatLimit, emailCampaignLimit: p.emailCampaignLimit, linkedInCampaignLimit: p.linkedInCampaignLimit }]));

    const now = Date.now();
    const items = rows.map((r, i) => ({
      id: r.id,
      plan: r.plan,
      validityDays: r.validityDays,
      startAt: r.startAt,
      endAt: r.endAt,
      amount: r.amount,
      currency: r.currency,
      invoiceNo: r.invoiceNo ?? clientRow?.invoiceNo ?? null,
      source: r.source,
      endedReason: r.endedReason,
      entitlements: (r.entitlements as Record<string, number> | null) ?? planMap.get(r.plan) ?? null,
      current: i === 0 && r.endedReason == null,
      status: this.status(r.endAt, r.endedReason, now),
      daysLeft: Math.ceil((new Date(r.endAt).getTime() - now) / 86_400_000),
    }));
    return { clientId, items };
  }
}
