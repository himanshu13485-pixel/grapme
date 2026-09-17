import { Injectable, Logger } from '@nestjs/common';
import {
  ContactStatus,
  EnrollmentStatus,
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
  SuppressionReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAlertsService } from '../notifications/admin-alerts.service';

/**
 * Central bounce handling shared by the send workers (SMTP-time hard failures)
 * and the inbound DSN parser. Also owns the per-mailbox bounce-rate circuit
 * breaker so a bad list can't keep torching sender reputation.
 */
@Injectable()
export class BounceService {
  private readonly logger = new Logger(BounceService.name);

  // Circuit-breaker thresholds (recent window, per mailbox).
  private static readonly SAMPLE = 100; // look at the last N outbound sends
  private static readonly MIN_VOLUME = 20; // don't judge on tiny samples
  /** Fallback when a tenant has no threshold of its own (Tenant.bounceMaxRatePct). */
  static readonly DEFAULT_MAX_RATE_PCT = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AdminAlertsService,
  ) {}

  /** True when a nodemailer/SMTP error is a PERMANENT (hard) failure: a 5xx reply
   *  code, or a recipient-rejected message when no code is exposed. */
  isHardSmtpError(err: unknown): boolean {
    const e = err as { responseCode?: number; response?: string } | undefined;
    if (typeof e?.responseCode === 'number') return e.responseCode >= 500 && e.responseCode < 600;
    const txt = `${e?.response ?? ''} ${String(err ?? '')}`.toLowerCase();
    return (
      /\b5\d\d\b/.test(txt) &&
      /(no such user|does ?n.?t exist|user unknown|mailbox unavailable|address rejected|recipient rejected|invalid recipient|no mailbox|user not found|recipient address rejected)/.test(txt)
    );
  }

  /**
   * Record a HARD bounce: suppress the address (reason BOUNCE), mark the contact
   * BOUNCED and stop its active enrollments, and flag the offending message with a
   * BOUNCE event. Idempotent. When messageId is omitted the contact's last
   * outbound message is used (so the inbound DSN path can call it directly).
   */
  async recordHardBounce(
    tenantId: string,
    email: string,
    opts?: { messageId?: string; campaignId?: string | null; reason?: string },
  ): Promise<void> {
    const reason = opts?.reason?.trim().slice(0, 500) || undefined;
    const addr = (email ?? '').trim();
    if (!addr) return;
    await this.prisma.suppression.upsert({
      where: { tenantId_email: { tenantId, email: addr } },
      update: { reason: SuppressionReason.BOUNCE },
      create: { tenantId, email: addr, reason: SuppressionReason.BOUNCE },
    });

    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, email: { equals: addr, mode: 'insensitive' } },
    });
    let messageId = opts?.messageId;
    let campaignId = opts?.campaignId ?? undefined;
    if (contact) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { status: ContactStatus.BOUNCED } });
      await this.prisma.enrollment.updateMany({
        where: { contactId: contact.id, status: EnrollmentStatus.ACTIVE },
        data: { status: EnrollmentStatus.STOPPED },
      });
      if (!messageId) {
        const last = await this.prisma.emailMessage.findFirst({
          where: { tenantId, contactId: contact.id, direction: MessageDirection.OUTBOUND },
          orderBy: { createdAt: 'desc' },
          select: { id: true, campaignId: true },
        });
        if (last) {
          messageId = last.id;
          campaignId = last.campaignId ?? undefined;
        }
      }
    }
    if (messageId) {
      await this.prisma.emailMessage
        .update({ where: { id: messageId }, data: { status: MessageStatus.BOUNCED, ...(reason ? { error: reason } : {}) } })
        .catch(() => undefined);
      const exists = await this.prisma.emailEvent.findFirst({
        where: { messageId, eventType: EventType.BOUNCE },
      });
      if (!exists) {
        await this.prisma.emailEvent.create({
          data: { messageId, campaignId, eventType: EventType.BOUNCE, meta: reason ? { reason } : {} },
        });
      }
    }
    this.logger.log(`Hard bounce recorded + suppressed: ${addr}`);
  }

  /**
   * Circuit breaker: auto-disable any ACTIVE mailbox whose recent bounce rate is
   * over the threshold, so it stops sending (eligibleMailboxes only uses ACTIVE).
   * Runs on the hourly reports tick.
   */
  async checkBounceRates(): Promise<{ disabled: number }> {
    const mailboxes = await this.prisma.emailAccount.findMany({
      where: { status: MailboxStatus.ACTIVE },
      select: { id: true, label: true, emailAddress: true, tenantId: true, clientId: true, bounceWindowFrom: true },
    });
    let disabled = 0;
    // One threshold lookup per tenant, not per mailbox.
    const maxRateByTenant = new Map<string, number>();
    for (const mb of mailboxes) {
      const recent = await this.prisma.emailMessage.findMany({
        where: {
          emailAccountId: mb.id,
          direction: MessageDirection.OUTBOUND,
          status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.BOUNCED] },
          // Only sends since the mailbox was last enabled. Re-enabling used to re-run the
          // same history: the bounces that tripped the breaker were still in the window,
          // so it disabled the mailbox again within the hour — and it could not send the
          // clean mail that would have diluted them, because it was disabled.
          ...(mb.bounceWindowFrom ? { createdAt: { gte: mb.bounceWindowFrom } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: BounceService.SAMPLE,
        select: { status: true },
      });
      if (recent.length < BounceService.MIN_VOLUME) continue;
      const bounced = recent.filter((m) => m.status === MessageStatus.BOUNCED).length;
      const rate = bounced / recent.length;
      const maxRate = await this.maxRateFor(mb.tenantId, maxRateByTenant);
      if (rate > maxRate) {
        const reason = `Auto-disabled: bounce rate ${(rate * 100).toFixed(1)}% over last ${recent.length} sends`;
        await this.prisma.emailAccount.update({
          where: { id: mb.id },
          data: { status: MailboxStatus.DISABLED, statusReason: reason },
        });
        disabled++;
        this.logger.warn(`Mailbox "${mb.label}" — ${reason}`);
        const client = mb.clientId
          ? await this.prisma.client.findUnique({ where: { id: mb.clientId }, select: { name: true } })
          : null;
        await this.alerts.channelDisabled(mb.tenantId, {
          kind: 'Mailbox',
          name: mb.label,
          identifier: mb.emailAddress,
          clientName: client?.name ?? null,
          reason: `${bounced} of the last ${recent.length} sends bounced (${(rate * 100).toFixed(1)}%), over the ${(maxRate * 100).toFixed(0)}% limit.`,
          whatNext: 'Clean the bounced addresses out of the contact list, then re-enable the mailbox from its Edit form.',
          link: '/mailboxes',
        });
      }
    }
    if (disabled) this.logger.warn(`Bounce circuit breaker disabled ${disabled} mailbox(es)`);
    return { disabled };
  }

  /** The tenant's configured bounce ceiling as a fraction, clamped to a sane 1–100%. */
  private async maxRateFor(tenantId: string, cache: Map<string, number>): Promise<number> {
    const hit = cache.get(tenantId);
    if (hit !== undefined) return hit;
    const t = await this.prisma.tenant
      .findUnique({ where: { id: tenantId }, select: { bounceMaxRatePct: true } })
      .catch(() => null);
    const pct = Math.min(100, Math.max(1, t?.bounceMaxRatePct ?? BounceService.DEFAULT_MAX_RATE_PCT));
    const rate = pct / 100;
    cache.set(tenantId, rate);
    return rate;
  }
}
