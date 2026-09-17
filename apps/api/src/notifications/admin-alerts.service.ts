import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService, NotifyPayload } from './notify.service';

/** A sending channel that stopped working and needs someone to look at it. */
export interface ChannelDisabledAlert {
  /** "Mailbox" or "LinkedIn account". */
  kind: string;
  /** Mailbox label / seat name. */
  name: string;
  /** Address or profile, when there is one. */
  identifier?: string | null;
  clientName?: string | null;
  /** Why it stopped — the status reason, in plain words. */
  reason: string;
  /** Where to go and fix it, e.g. "/mailboxes". */
  link: string;
  /** What to do about it, if there's a clear next step. */
  whatNext?: string;
}

/**
 * Alerts to the tenant's admins and sub-admins.
 *
 * Sending channels used to fail silently: the bounce breaker disabled a mailbox and a
 * LinkedIn seat hit a checkpoint with nothing to tell anyone, so it was only noticed
 * when someone happened to open the page and saw work had stopped.
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  /** Every active admin / sub-admin in the tenant. */
  private async adminIds(tenantId: string): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: { tenantId, role: { in: [Role.SUPER_ADMIN, Role.SUB_ADMIN] }, status: 'ACTIVE' },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  /** Bell + email to the admins. Best-effort: alerting must never break the action. */
  async alertAdmins(tenantId: string, payload: NotifyPayload): Promise<void> {
    try {
      const ids = await this.adminIds(tenantId);
      if (ids.length === 0) {
        this.logger.warn(`No active admins to alert in tenant ${tenantId}: ${payload.title}`);
        return;
      }
      // Bell + email only. These are operational alerts; messaging channels are
      // reserved for things the recipient opted into.
      await this.notify.notifyMany(ids, payload, { inApp: true, email: true, whatsapp: false });
    } catch (err) {
      this.logger.warn(`Admin alert failed (${payload.title}): ${err}`);
    }
  }

  /** "Mailbox disabled" / "LinkedIn account disconnected" — who it belongs to, why, what next. */
  async channelDisabled(tenantId: string, a: ChannelDisabledAlert): Promise<void> {
    const who = a.clientName ? ` — ${a.clientName}` : '';
    const subject = `${a.kind} stopped: ${a.name}${who}`;
    const line = `${a.kind} "${a.name}"${a.identifier ? ` (${a.identifier})` : ''}${a.clientName ? ` for ${a.clientName}` : ''} has stopped sending. ${a.reason}`;
    await this.alertAdmins(tenantId, {
      type: 'channel_disabled',
      title: subject,
      body: `${line}${a.whatNext ? ` ${a.whatNext}` : ''}`,
      emailHtml:
        `<p><strong>${esc(a.kind)} "${esc(a.name)}"</strong>${a.identifier ? ` (${esc(a.identifier)})` : ''}` +
        `${a.clientName ? ` for <strong>${esc(a.clientName)}</strong>` : ''} has stopped sending.</p>` +
        `<p><strong>Reason:</strong> ${esc(a.reason)}</p>` +
        (a.whatNext ? `<p>${esc(a.whatNext)}</p>` : '') +
        '<p>Outreach on this channel is paused until it is working again.</p>',
      link: a.link,
    });
  }
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
