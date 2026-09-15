import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type SubStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED';

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER];
const EXPIRING_DAYS = 7;

/** Audit actions that change a client's details or subscription. */
const CHANGE_ACTIONS = [
  'UPDATE_CLIENT', 'RENEW_CLIENT', 'SET_CLIENT_VALIDITY', 'EXTEND_CLIENT_VALIDITY',
  'ACTIVATE_CLIENT', 'DEACTIVATE_CLIENT', 'FORCE_EXPIRE_SUBSCRIPTION',
] as const;

/** Human labels for the client fields most likely to appear in the change history. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Company name', invoiceNo: 'Invoice no.', invoiceDate: 'Invoice date',
  contactPerson: 'Contact person', email: 'Contact email', mobile: 'Mobile no.',
  productCategory: 'Product / Category', serviceType: 'Service type', plan: 'Plan',
  validityDays: 'Validity (days)', expiresAt: 'Expires', addedDays: 'Days added', status: 'Status',
  emailEnabled: 'Email channel', linkedInEnabled: 'LinkedIn channel', linkedInCreditMetering: 'LinkedIn credit metering',
  emailCredits: 'Email credits', emailCreditMetering: 'Email credit metering', mailboxLimit: 'Mailbox limit',
  emailCampaignLimit: 'Email campaign limit', monthlyQuota: 'Contacts / month', dailyBatchSize: 'Sends / day',
  batchWindowDays: 'Batch window (days)', stageIntervalDays: 'Gap between stages (days)',
  followUpCount: 'Follow-ups', workDays: 'Send days', emailJitterSeconds: 'Send stagger (sec)',
  sendWindowStart: 'Send window start', sendWindowEnd: 'Send window end',
  stageIntervalJitterDays: 'Interval jitter (days)', operationContacts: 'Operation contacts',
};

/** Render an audited value for display; dates as yyyy-mm-dd so re-saves of the same day compare equal. */
function displayValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field.toLowerCase().includes('date') || field === 'expiresAt') {
    const d = new Date(v as string);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

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
    opts: {
      plan?: string | null; validityDays: number | null; amount?: number | null; currency?: string | null;
      source?: string; endAt?: Date | null;
      /** Who entered it (renewals are submitted by a staff user). */
      recordedById?: string | null; recordedByName?: string | null;
    },
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
      this.prisma.client.findUnique({ where: { id: clientId }, select: { invoiceNo: true, invoiceDate: true } }),
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
        invoiceDate: client?.invoiceDate ?? null,
        recordedById: opts.recordedById ?? null,
        recordedByName: opts.recordedByName ?? null,
        source: opts.source ?? 'admin',
        ...(entitlements ? { entitlements } : {}),
      },
    });
  }

  /**
   * Push the running period's end out when an admin adds days to the current
   * window. Same subscription, just longer — so it's updated in place rather
   * than closed as SUPERSEDED and replaced like a fresh validity would be.
   */
  async extendOpen(clientId: string, addDays: number, newEndAt: Date) {
    const open = await this.prisma.subscriptionPeriod.findFirst({
      where: { clientId, endedReason: null, endAt: { gt: new Date() } },
      orderBy: { startAt: 'desc' },
    });
    if (!open) return null;
    return this.prisma.subscriptionPeriod.update({
      where: { id: open.id },
      data: { endAt: newEndAt, validityDays: open.validityDays + addDays },
    });
  }

  /**
   * Make sure the subscription a renewal is about to replace is on record, with its invoice.
   *
   * Clients set up before the history existed often have no period for their current
   * window, and periods recorded before invoice dates were snapshotted lack one. Without
   * this, renewing would record the new invoice and the previous one would simply vanish.
   * Never overwrites a snapshot that is already there.
   */
  async snapshotCurrent(
    tenantId: string,
    client: {
      id: string; plan: string; invoiceNo: string | null; invoiceDate: Date | null;
      validityDays: number | null; validityStartAt: Date | null; createdAt: Date;
    },
  ) {
    const now = new Date();
    const start = client.validityStartAt;
    const latest = await this.prisma.subscriptionPeriod.findFirst({
      where: { clientId: client.id },
      orderBy: { startAt: 'desc' },
    });
    // A period is "this window" if it began no earlier than the window did (record() runs
    // moments after the client row is written, so allow a little slack).
    const coversWindow = latest && (!start || latest.startAt.getTime() >= start.getTime() - 5 * 60_000);
    if (latest && coversWindow) {
      if (latest.invoiceNo && latest.invoiceDate) return latest;
      return this.prisma.subscriptionPeriod.update({
        where: { id: latest.id },
        data: {
          invoiceNo: latest.invoiceNo ?? client.invoiceNo,
          invoiceDate: latest.invoiceDate ?? client.invoiceDate,
        },
      });
    }
    if (!client.invoiceNo && !client.invoiceDate && !start) return null; // nothing to keep
    const startAt = start ?? client.invoiceDate ?? client.createdAt;
    const endAt = start && client.validityDays
      ? new Date(start.getTime() + client.validityDays * 86_400_000)
      : now;
    return this.prisma.subscriptionPeriod.create({
      data: {
        tenantId, clientId: client.id,
        plan: client.plan || '—',
        validityDays: client.validityDays ?? 0,
        startAt,
        endAt: endAt > now ? now : endAt,
        invoiceNo: client.invoiceNo,
        invoiceDate: client.invoiceDate,
        source: 'backfill',
        endedReason: endAt > now ? 'SUPERSEDED' : null,
      },
    });
  }

  /**
   * What changed on a client, field by field, and who changed it — read from the audit
   * log that every client edit, renewal and validity action already writes. Staff only.
   */
  async changeHistoryForClient(user: AuthUser, clientId: string) {
    if (user.role === Role.CLIENT) throw new ForbiddenException('Staff only');
    const ok = await this.prisma.client.count({ where: { id: clientId, tenantId: user.tenantId } });
    if (!ok) throw new ForbiddenException('You do not have access to this client');

    const logs = await this.prisma.activityLog.findMany({
      where: { tenantId: user.tenantId, entityType: 'Client', entityId: clientId, action: { in: [...CHANGE_ACTIONS] } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      include: { actor: { select: { name: true, email: true } } },
    });

    const items: { at: Date; by: string; action: string; field: string; label: string; from: string; to: string }[] = [];
    for (const log of logs) {
      const by = log.actor?.name || log.actor?.email || 'System';
      const before = (log.before ?? {}) as Record<string, unknown>;
      const after = (log.after ?? {}) as Record<string, unknown>;
      for (const field of Object.keys(after)) {
        if (field === 'client') continue; // a name echo on status/validity actions, not a change
        const from = displayValue(field, before[field]);
        const to = displayValue(field, after[field]);
        if (from === to) continue;
        items.push({ at: log.occurredAt, by, action: log.action, field, label: FIELD_LABELS[field] ?? field, from, to });
      }
    }
    return { clientId, items };
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
    const clientRow = await this.prisma.client.findUnique({ where: { id: clientId }, select: { invoiceNo: true, invoiceDate: true } });
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
      // Fall back to the client's current invoice only for the current period. Applying it
      // to older periods would stamp a renewal's new invoice onto the ones it replaced.
      invoiceNo: r.invoiceNo ?? (i === 0 ? clientRow?.invoiceNo ?? null : null),
      invoiceDate: r.invoiceDate ?? (i === 0 ? clientRow?.invoiceDate ?? null : null),
      recordedByName: r.recordedByName,
      createdAt: r.createdAt,
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
