import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { cohortRef } from '../common/cohort-ref.util';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

const PERIOD_DAYS: Record<ReportPeriod, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};
const PERIOD_LABEL: Record<ReportPeriod, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

interface ReportData {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  activeCohorts: number;
  cohorts: { label: string; sent: number; opens: number; clicks: number; replies: number }[];
}

/**
 * Builds and emails a professional performance report for a client, covering
 * everything sent through that client's mailbox group (cohorts + campaigns) in
 * the period: emails sent, opens, clicks, replies received, bounces.
 */
@Injectable()
export class ClientReportService {
  private readonly logger = new Logger(ClientReportService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  /** Aggregate metrics for a client over the period window. */
  async buildReport(clientId: string, period: ReportPeriod): Promise<ReportData> {
    const since = new Date(Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

    const msgs = await this.prisma.emailMessage.findMany({
      where: {
        emailAccount: { clientId },
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: since },
      },
      select: { id: true, status: true, cohortId: true },
    });
    const sent = msgs.filter(
      (m) => m.status === MessageStatus.SENT || m.status === MessageStatus.DELIVERED,
    ).length;
    const bounces = msgs.filter((m) => m.status === MessageStatus.BOUNCED).length;
    const ids = msgs.map((m) => m.id);

    const evs = ids.length
      ? await this.prisma.emailEvent.findMany({
          where: {
            messageId: { in: ids },
            eventType: { in: [EventType.OPEN, EventType.CLICK] },
          },
          select: { eventType: true, messageId: true },
        })
      : [];
    const openSet = new Set<string>();
    const clickSet = new Set<string>();
    for (const e of evs) {
      if (e.eventType === EventType.OPEN) openSet.add(e.messageId);
      else if (e.eventType === EventType.CLICK) clickSet.add(e.messageId);
    }

    // Replies actually received from buyers in the window.
    const replies = await this.prisma.emailMessage.count({
      where: {
        emailAccount: { clientId },
        direction: MessageDirection.INBOUND,
        createdAt: { gte: since },
      },
    });

    const activeCohorts = await this.prisma.cohort.count({
      where: { clientId, status: 'RUNNING' },
    });

    // Per-cohort breakdown for the cohorts that sent in the window.
    const byCohort = new Map<string, { sent: number; opens: number; clicks: number }>();
    const msgCohort = new Map<string, string | null>();
    for (const m of msgs) {
      msgCohort.set(m.id, m.cohortId);
      if (!m.cohortId) continue;
      const c = byCohort.get(m.cohortId) ?? { sent: 0, opens: 0, clicks: 0 };
      if (m.status === MessageStatus.SENT || m.status === MessageStatus.DELIVERED) c.sent++;
      byCohort.set(m.cohortId, c);
    }
    for (const mid of openSet) {
      const cid = msgCohort.get(mid);
      if (cid && byCohort.has(cid)) byCohort.get(cid)!.opens++;
    }
    for (const mid of clickSet) {
      const cid = msgCohort.get(mid);
      if (cid && byCohort.has(cid)) byCohort.get(cid)!.clicks++;
    }
    const cohortRows = await this.prisma.cohort.findMany({
      where: { id: { in: [...byCohort.keys()] } },
      select: { id: true, label: true, monthIndex: true, subIndex: true },
    });
    const cohorts = cohortRows.map((c) => {
      const m = byCohort.get(c.id)!;
      return {
        label: c.label || `Cohort ${cohortRef(c.monthIndex, c.subIndex)}`,
        sent: m.sent,
        opens: m.opens,
        clicks: m.clicks,
        replies: 0,
      };
    });

    const pct = (n: number) => (sent ? Math.round((n / sent) * 1000) / 10 : 0);
    return {
      sent,
      delivered: sent,
      opens: openSet.size,
      clicks: clickSet.size,
      replies,
      bounces,
      openRate: pct(openSet.size),
      clickRate: pct(clickSet.size),
      replyRate: pct(replies),
      bounceRate: pct(bounces),
      activeCohorts,
      cohorts,
    };
  }

  /** Professional HTML email body. */
  renderHtml(
    clientName: string,
    contactPerson: string | null,
    period: ReportPeriod,
    data: ReportData,
  ): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const stat = (label: string, value: string | number, sub?: string) => `
      <td style="padding:14px 10px;text-align:center;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px">
        <div style="font-size:22px;font-weight:700;color:#1e293b">${value}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b">${label}</div>
        ${sub ? `<div style="font-size:11px;color:#94a3b8">${sub}</div>` : ''}
      </td>`;
    const cohortRows = data.cohorts.length
      ? data.cohorts
          .map(
            (c) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">${c.label}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">${c.sent}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">${c.opens}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">${c.clicks}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" style="padding:10px;color:#94a3b8">No cohort activity in this period.</td></tr>`;

    return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#334155">
    <div style="background:#4f46e5;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:700">GrapMe — ${PERIOD_LABEL[period]} Outreach Report</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px">${clientName} · ${today}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 16px">Hello${contactPerson ? ' ' + contactPerson : ''},</p>
      <p style="margin:0 0 18px">Here is your ${PERIOD_LABEL[period].toLowerCase()} summary of outreach performance across your campaigns.</p>

      <table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:6px">
        <tr>
          ${stat('Emails sent', data.sent)}
          ${stat('Opens', data.opens, `${data.openRate}%`)}
          ${stat('Clicks', data.clicks, `${data.clickRate}%`)}
        </tr>
        <tr>
          ${stat('Replies', data.replies, `${data.replyRate}%`)}
          ${stat('Bounces', data.bounces, `${data.bounceRate}%`)}
          ${stat('Active cohorts', data.activeCohorts)}
        </tr>
      </table>

      <h3 style="font-size:14px;color:#1e293b;margin:24px 0 8px">By cohort</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:11px;text-transform:uppercase">
            <th style="padding:6px 10px">Cohort</th>
            <th style="padding:6px 10px;text-align:right">Sent</th>
            <th style="padding:6px 10px;text-align:right">Opens</th>
            <th style="padding:6px 10px;text-align:right">Clicks</th>
          </tr>
        </thead>
        <tbody>${cohortRows}</tbody>
      </table>

      <p style="margin:24px 0 0;font-size:13px;color:#64748b">
        This is an automated performance report from your GrapMe outreach program.
        Reply to this email if you'd like to discuss the results.
      </p>
    </div>
    <div style="text-align:center;color:#94a3b8;font-size:11px;margin:14px 0">
      Sent by GrapMe on behalf of your outreach program.
    </div>
  </div>`;
  }

  /**
   * Compose + email the report to the client (cc the tenant admin). Sends from
   * the client's first active mailbox. Returns a result for the UI / cron.
   */
  async sendReport(
    clientId: string,
    period: ReportPeriod,
  ): Promise<{ sent: boolean; detail: string }> {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return { sent: false, detail: 'Client not found.' };
    if (!client.email)
      return {
        sent: false,
        detail: 'No client contact email set — add one on the client.',
      };

    // Reports are sent FROM the admin's email (not the client's mailbox), TO the
    // client's contact email.
    const admin = await this.prisma.user.findFirst({
      where: { tenantId: client.tenantId, role: Role.SUPER_ADMIN },
      select: { email: true },
    });
    const mailbox = await this.resolveAdminMailbox(client.tenantId, admin?.email);
    if (!mailbox)
      return {
        sent: false,
        detail:
          'No admin mailbox available to send from. Add an active mailbox (ideally the admin address) under Mailboxes.',
      };

    const data = await this.buildReport(clientId, period);
    const html = this.renderHtml(client.name, client.contactPerson, period, data);
    const subject = `${PERIOD_LABEL[period]} outreach report — ${client.name}`;

    try {
      await this.mailer.send({
        account: mailbox,
        to: client.email,
        subject,
        html,
      });
      return {
        sent: true,
        detail: `Report emailed to ${client.email} from ${mailbox.emailAddress}.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Report send failed for ${client.name}: ${msg}`);
      return { sent: false, detail: `Send failed: ${msg}` };
    }
  }

  /** The address client reports will be sent FROM, plus the explicit pick. */
  async senderAddress(
    tenantId: string,
  ): Promise<{ from: string | null; mailboxId: string | null; explicit: boolean }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { reportMailboxId: true },
    });
    const admin = await this.prisma.user.findFirst({
      where: { tenantId, role: Role.SUPER_ADMIN },
      select: { email: true },
    });
    const mailbox = await this.resolveAdminMailbox(tenantId, admin?.email);
    return {
      from: mailbox?.emailAddress ?? null,
      mailboxId: tenant?.reportMailboxId ?? null,
      explicit: !!tenant?.reportMailboxId,
    };
  }

  /** Active mailboxes that can be chosen as the report sender. */
  async senderOptions(tenantId: string) {
    return this.prisma.emailAccount.findMany({
      where: { tenantId, status: MailboxStatus.ACTIVE },
      select: { id: true, label: true, emailAddress: true, clientId: true },
      orderBy: [{ clientId: 'asc' }, { emailAddress: 'asc' }],
    });
  }

  /** Set (or clear with null) the explicit report-sender mailbox. */
  async setSender(tenantId: string, mailboxId: string | null) {
    if (mailboxId) {
      const ok = await this.prisma.emailAccount.findFirst({
        where: { id: mailboxId, tenantId },
        select: { id: true },
      });
      if (!ok) throw new NotFoundException('Mailbox not found');
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { reportMailboxId: mailboxId },
    });
    return this.senderAddress(tenantId);
  }

  /**
   * The mailbox reports are sent from: the explicitly chosen one (if still
   * active), else one matching the admin's email, else any tenant-level
   * (unassigned) mailbox, else any active mailbox.
   */
  private async resolveAdminMailbox(tenantId: string, adminEmail?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { reportMailboxId: true },
    });
    if (tenant?.reportMailboxId) {
      const picked = await this.prisma.emailAccount.findFirst({
        where: {
          id: tenant.reportMailboxId,
          tenantId,
          status: MailboxStatus.ACTIVE,
        },
      });
      if (picked) return picked;
    }
    if (adminEmail) {
      const byEmail = await this.prisma.emailAccount.findFirst({
        where: {
          tenantId,
          status: MailboxStatus.ACTIVE,
          emailAddress: { equals: adminEmail, mode: 'insensitive' },
        },
      });
      if (byEmail) return byEmail;
    }
    const shared = await this.prisma.emailAccount.findFirst({
      where: { tenantId, status: MailboxStatus.ACTIVE, clientId: null },
      orderBy: { rotationOrder: 'asc' },
    });
    if (shared) return shared;
    return this.prisma.emailAccount.findFirst({
      where: { tenantId, status: MailboxStatus.ACTIVE },
      orderBy: { rotationOrder: 'asc' },
    });
  }

  /**
   * Cron: send any client reports that are enabled and due now. Daily fires
   * every day, weekly on Mondays, monthly on the 1st — each at the client's
   * reportHour, guarded so it sends at most once per period.
   */
  async runDueReports(): Promise<{ sent: number }> {
    const now = new Date();
    const hour = now.getHours();
    const clients = await this.prisma.client.findMany({
      where: {
        email: { not: null },
        OR: [{ reportDaily: true }, { reportWeekly: true }, { reportMonthly: true }],
      },
    });
    let sent = 0;
    for (const c of clients) {
      if (hour < c.reportHour) continue;
      const due: ReportPeriod[] = [];
      if (c.reportDaily && !sameDay(c.reportLastDailyAt, now)) due.push('daily');
      if (c.reportWeekly && now.getDay() === 1 && !sameDay(c.reportLastWeeklyAt, now))
        due.push('weekly');
      if (c.reportMonthly && now.getDate() === 1 && !sameDay(c.reportLastMonthlyAt, now))
        due.push('monthly');
      for (const period of due) {
        const res = await this.sendReport(c.id, period);
        if (res.sent) {
          sent++;
          const field =
            period === 'daily'
              ? 'reportLastDailyAt'
              : period === 'weekly'
                ? 'reportLastWeeklyAt'
                : 'reportLastMonthlyAt';
          await this.prisma.client.update({
            where: { id: c.id },
            data: { [field]: now },
          });
        }
      }
    }
    return { sent };
  }
}

function sameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
