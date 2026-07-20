import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';

export interface NotifyPayload {
  /** Notification "type" key stored on the bell row, e.g. 'support'. */
  type: string;
  title: string;
  /** Plain-text preview / body (used for the bell row and as the email fallback). */
  body?: string;
  /** In-app deep link, e.g. `/support?ticket=<id>`. */
  link?: string;
  /** Optional rich HTML for the email body; falls back to an escaped `body`. */
  emailHtml?: string;
  /** Optional WhatsApp text; falls back to `title`. */
  whatsappText?: string;
  /** Optional files attached to the alert email (e.g. a support message attachment). */
  emailAttachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Per-call channel gates (default: all enabled). Email/WhatsApp still additionally
 *  respect each recipient's own preference. */
export interface NotifyChannels {
  inApp?: boolean;
  email?: boolean;
  whatsapp?: boolean;
}

/**
 * Central notification helper. For a given user it ALWAYS creates an in-app bell
 * alert, and — respecting that user's per-user preferences — also sends a branded
 * email (if notifyEmail) and a WhatsApp message (if notifyWhatsapp + a phone on
 * file). WhatsApp is a recorded stub in this project (no provider wired), so it
 * only logs. Every external send is best-effort: wrapped in try/catch and logged,
 * so a failing email/WhatsApp/bell insert can NEVER 500 the user's action.
 *
 * NOTE: this is for *alerts*. Transactional mail (verification, password reset,
 * welcome) must bypass this and always send — see AuthService / SalesService.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /** Notify a single user (best-effort; never throws). */
  async notify(userId: string, payload: NotifyPayload, channels?: NotifyChannels): Promise<void> {
    if (!userId) return;
    await this.notifyMany([userId], payload, channels);
  }

  /**
   * Notify several users at once (deduped; best-effort; never throws).
   * `channels` gates each delivery channel for THIS call (default: all on). The
   * in-app bell obeys only `channels.inApp`; email/WhatsApp additionally respect
   * each recipient's own notifyEmail/notifyWhatsapp preference.
   */
  async notifyMany(userIds: string[], payload: NotifyPayload, channels?: NotifyChannels): Promise<void> {
    const ch = { inApp: true, email: true, whatsapp: true, ...(channels ?? {}) };
    const ids = [...new Set((userIds ?? []).filter(Boolean))];
    if (ids.length === 0) return;

    let users: {
      id: string;
      tenantId: string;
      email: string;
      name: string;
      notifyEmail: boolean;
      notifyWhatsapp: boolean;
      contactMobile: string | null;
    }[] = [];
    try {
      users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          notifyEmail: true,
          notifyWhatsapp: true,
          contactMobile: true,
        },
      });
    } catch (err) {
      this.logger.warn(`notifyMany: could not load recipients: ${err}`);
      return;
    }
    if (users.length === 0) return;

    // 1) In-app bell — on unless this call disabled it. One insert for all recipients.
    if (ch.inApp) try {
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: payload.type,
          title: payload.title,
          body: (payload.body ?? '').slice(0, 280) || null,
          link: payload.link ?? null,
        })),
      });
    } catch (err) {
      this.logger.warn(`notifyMany: bell insert failed: ${err}`);
    }

    // 2) Email (per preference) + 3) WhatsApp stub (per preference). Grouped so we
    // resolve each tenant's sending mailbox once.
    const wantsEmail = (u: (typeof users)[number]) => ch.email && u.notifyEmail && !!u.email;
    const wantsWhatsapp = (u: (typeof users)[number]) =>
      ch.whatsapp && u.notifyWhatsapp && !!u.contactMobile;

    const emailByTenant = new Map<string, typeof users>();
    for (const u of users) {
      if (!wantsEmail(u)) continue;
      const list = emailByTenant.get(u.tenantId) ?? [];
      list.push(u);
      emailByTenant.set(u.tenantId, list);
    }

    for (const [tenantId, recipients] of emailByTenant) {
      let account = null as Awaited<ReturnType<typeof this.systemMailbox>>;
      try {
        account = await this.systemMailbox(tenantId);
      } catch (err) {
        this.logger.warn(`notifyMany: mailbox lookup failed for ${tenantId}: ${err}`);
      }
      if (!account) {
        this.logger.warn(`notifyMany: no sending mailbox for tenant ${tenantId}; skipped ${recipients.length} email(s).`);
        continue;
      }
      const html = this.emailHtml(payload);
      for (const u of recipients) {
        try {
          await this.mailer.send({
            account,
            to: u.email,
            subject: payload.title,
            html,
            attachments: payload.emailAttachments,
          });
        } catch (err) {
          this.logger.warn(`notifyMany: email to ${u.email} failed: ${err}`);
        }
      }
    }

    // WhatsApp — recorded stub only (no provider wired). Best-effort log.
    for (const u of users) {
      if (!wantsWhatsapp(u)) continue;
      try {
        const text = payload.whatsappText ?? payload.title;
        this.logger.log(
          `[whatsapp-stub] would notify ${u.contactMobile} — "${text}". Wire WHATSAPP_TOKEN/PHONE_ID to enable.`,
        );
      } catch {
        /* never throws */
      }
    }
  }

  /** Resolve the tenant's outbound mailbox (explicit report mailbox, else the oldest). */
  private async systemMailbox(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { reportMailboxId: true },
    });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({ where: { id: tenant.reportMailboxId } });
      if (acct) return acct;
    }
    return this.prisma.emailAccount.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  /** Branded email body matching the Updates/auth email style. */
  private emailHtml(payload: NotifyPayload): string {
    const webUrl = (process.env.WEB_PUBLIC_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    const bodyHtml = payload.emailHtml ?? `<p style="white-space:pre-wrap;margin:0">${escapeHtml(payload.body ?? '')}</p>`;
    const button = payload.link
      ? `<p style="margin:22px 0">
           <a href="${webUrl}${payload.link}" style="background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open in GrapMe</a>
         </p>`
      : '';
    return `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#0f766e;font-size:18px">${escapeHtml(payload.title)}</h2>
        <div style="color:#334155;font-size:14px;line-height:1.6;word-break:break-word">${bodyHtml}</div>
        ${button}
        <p style="color:#94a3b8;font-size:12px">You're receiving this because notifications are enabled on your GrapMe account. Manage them under My Account.</p>
      </div>`;
  }
}

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
