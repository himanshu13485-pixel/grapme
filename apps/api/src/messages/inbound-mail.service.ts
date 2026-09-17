import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  EnrollmentStatus,
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
  Role,
  SuppressionReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { decryptCredential } from '../common/crypto/credential-crypto';
import { BounceService } from '../bounce/bounce.service';
import { HeaderMap, domainOf, isAutoReply, isFreeMailDomain, threadRefs } from './inbound-classify';

/** How far back a same-domain reply may be matched to a contact we wrote to. */
const DOMAIN_MATCH_DAYS = 90;

/**
 * Pulls inbound mail (replies) from each IMAP-capable mailbox and records it.
 * Used both by the background reply-poll worker and by the on-demand "Sync now"
 * button, so the two always behave identically.
 */
@Injectable()
export class InboundMailService {
  private readonly logger = new Logger(InboundMailService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
    private bounce: BounceService,
  ) {}

  /** Poll every active IMAP mailbox across all tenants (background worker). */
  async syncAll(sinceDays = 1): Promise<void> {
    const mailboxes = await this.prisma.emailAccount.findMany({
      where: { status: MailboxStatus.ACTIVE, imapHost: { not: null } },
    });
    for (const mailbox of mailboxes) {
      try {
        await this.pollMailbox(mailbox, sinceDays);
      } catch (err) {
        this.logger.warn(`IMAP poll failed for ${mailbox.emailAddress}: ${err}`);
      }
    }
  }

  /**
   * On-demand: poll one tenant's active IMAP mailboxes (optionally just one
   * client's) and return how many new messages were stored. Looks back further
   * than the background poll so a manual sync also backfills.
   */
  async syncTenant(
    tenantId: string,
    clientId?: string,
    sinceDays = 14,
  ): Promise<{ scanned: number; stored: number; errors: string[] }> {
    const mailboxes = await this.prisma.emailAccount.findMany({
      where: {
        tenantId,
        status: MailboxStatus.ACTIVE,
        imapHost: { not: null },
        ...(clientId ? { clientId } : {}),
      },
    });
    let stored = 0;
    const errors: string[] = [];
    for (const mailbox of mailboxes) {
      try {
        stored += await this.pollMailbox(mailbox, sinceDays);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${mailbox.emailAddress}: ${msg}`);
        this.logger.warn(`IMAP poll failed for ${mailbox.emailAddress}: ${msg}`);
      }
    }
    return { scanned: mailboxes.length, stored, errors };
  }

  /** Connects, fetches recent mail, stores new inbound. Returns # newly stored. */
  private async pollMailbox(mailbox: any, sinceDays: number): Promise<number> {
    // Encryption mode: SSL = implicit TLS (993); STARTTLS/NONE connect plaintext and
    // ImapFlow upgrades via STARTTLS when available (secure: false).
    const imapMode = mailbox.imapEncryption || 'SSL';
    const client = new ImapFlow({
      host: mailbox.imapHost,
      port: mailbox.imapPort ?? 993,
      secure: imapMode === 'SSL',
      auth: {
        // IMAP login often differs from SMTP (e.g. SES sends, mail host receives).
        user: mailbox.imapUsername || mailbox.emailAddress,
        pass: decryptCredential(
          mailbox.imapCredentialsEncrypted ?? mailbox.credentialsEncrypted,
        ),
      },
      // Some self-hosted mail servers present a self-signed / private-CA cert.
      tls: mailbox.imapAllowSelfSigned
        ? { rejectUnauthorized: false }
        : undefined,
      logger: false,
    });

    let stored = 0;
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
        const found = await client.search({ since }, { uid: true });
        const uids = Array.isArray(found) ? found : [];
        if (uids.length) {
          for await (const msg of client.fetch(
            uids,
            { envelope: true, source: true },
            { uid: true },
          )) {
            const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
            if (!from) continue;
            const subject = msg.envelope?.subject ?? undefined;
            const receivedAt = msg.envelope?.date
              ? new Date(msg.envelope.date)
              : undefined;
            // Stable de-dupe key: real Message-ID, else from|subject|date.
            const dedupeId =
              msg.envelope?.messageId ??
              `${from}|${subject ?? ''}|${msg.envelope?.date ?? ''}`;
            const raw = msg.source ? msg.source.toString('utf8') : '';
            // Parse once: readable body, the headers that mark auto-responders, and the
            // thread ids this message answers.
            const parsed = await this.parseMessage(msg.source);
            const body = parsed.body ?? (raw ? this.extractTextBody(raw) : undefined);
            const bounce = this.isBounce(from, subject);
            const kind = bounce
              ? 'BOUNCE'
              : isAutoReply(parsed.headers, subject)
                ? 'AUTO_REPLY'
                : 'REPLY';
            // Who it belongs to: the sender if we know them, else the thread it answers,
            // else a colleague on the same company domain.
            const match = bounce
              ? null
              : await this.resolveContact(mailbox.tenantId, from, threadRefs(parsed.inReplyTo, parsed.references));
            const contact = match?.contact ?? null;
            const isNew = await this.storeInbound(mailbox, from, subject, dedupeId, body, receivedAt, {
              contactId: contact?.id ?? null,
              inReplyTo: parsed.inReplyTo ?? null,
              kind,
            });
            if (isNew) {
              stored++;
              if (bounce) {
                // A delivery failure is not a reply: suppress the failed recipient
                // instead of recording a REPLY against the sender.
                const rcpt = this.extractBounceRecipient(raw);
                if (rcpt) await this.handleBounce(mailbox.tenantId, rcpt, raw);
              } else if (kind === 'AUTO_REPLY') {
                // Kept in the inbox so it can be read, but it is not a reply: nobody has
                // seen the mail yet, so the follow-ups must keep going.
                this.logger.log(`Auto-reply ignored from ${from}: ${subject ?? '(no subject)'}`);
              } else {
                // Logged here, not while matching: matching re-runs on every poll pass,
                // so logging there made one email look like several replies.
                if (match && match.via !== 'sender') {
                  this.logger.log(`Reply from ${from} matched to ${match.contact.email} by ${match.via}`);
                }
                if (contact) await this.recordReply(contact, from);
                // Alert the client (CC admin) that a reply landed. Never let a
                // notification failure interrupt the poll.
                try {
                  await this.notifyClientOfReply(mailbox, from, subject);
                } catch (err) {
                  this.logger.warn(`Reply alert failed for ${from}: ${err}`);
                }
              }
            }
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return stored;
  }

  /** Persists an inbound email so it appears in the Inbox (de-duped). Returns
   *  true only when a new row was created. */
  private async storeInbound(
    mailbox: any,
    from: string,
    subject: string | undefined,
    dedupeId: string,
    body?: string,
    receivedAt?: Date,
    meta?: { contactId?: string | null; inReplyTo?: string | null; kind?: string },
  ): Promise<boolean> {
    const existing = await this.prisma.emailMessage.findFirst({
      where: {
        tenantId: mailbox.tenantId,
        direction: MessageDirection.INBOUND,
        messageId: dedupeId,
      },
    });
    if (existing) {
      // Self-heal a body stored by an older parser that left raw MIME (boundary
      // markers / undecoded transfer encoding) — re-extract on the next sync.
      const fresh = this.sanitizeForDb(body?.slice(0, 20000));
      const looksRaw =
        existing.body == null ||
        /content-transfer-encoding:|^--[-\w]/im.test(existing.body);
      if (fresh && looksRaw && fresh !== existing.body) {
        await this.prisma.emailMessage.update({
          where: { id: existing.id },
          data: { body: fresh },
        });
      }
      return false;
    }

    await this.prisma.emailMessage.create({
      data: {
        tenantId: mailbox.tenantId,
        emailAccountId: mailbox.id,
        // Resolved by the caller: sender, thread, or company domain.
        contactId: meta?.contactId ?? null,
        direction: MessageDirection.INBOUND,
        status: MessageStatus.DELIVERED,
        messageId: dedupeId,
        inReplyTo: meta?.inReplyTo ?? null,
        inboundKind: meta?.kind ?? null,
        fromAddress: from,
        subject: this.sanitizeForDb(subject),
        body: this.sanitizeForDb(body?.slice(0, 20000)),
        // Real received time so the Inbox "When" column reflects the email, not
        // the moment we happened to poll it.
        sentAt: receivedAt ?? null,
      },
    });
    this.logger.log(`Inbound stored from ${from}`);
    return true;
  }

  /**
   * Makes arbitrary inbound text safe to store so one odd email can never crash
   * the poller. Maps common smart punctuation to ASCII, then drops characters
   * the database can't encode. The dev DB cluster is WIN1252 (the Windows initdb
   * default), which rejects emoji / CJK / etc.; this keeps Latin text (incl.
   * accents) and strips the rest. Also strips NUL + control chars, which even a
   * UTF-8 database rejects. Once the cluster is recreated as UTF8 the > 0xFF
   * drop can be removed to keep full Unicode.
   */
  private sanitizeForDb(s?: string): string | undefined {
    if (s == null) return s;
    // Smart punctuation -> ASCII (escapes only; no literal high chars in source).
    const mapped = s
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...');
    let out = '';
    for (const ch of mapped) {
      const c = ch.codePointAt(0)!;
      if (c === 0x09 || c === 0x0a || c === 0x0d) {
        out += ch; // keep tab / newline / carriage return
      } else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
        continue; // drop C0 / C1 control chars
      } else if (c > 0xff) {
        continue; // drop chars the WIN1252 cluster can't store (emoji, CJK, …)
      } else {
        out += ch;
      }
    }
    return out;
  }

  /** Reliable body extraction via mailparser (handles multipart, quoted-printable,
   *  base64, charsets). Prefers text/plain, falls back to stripped HTML. Returns
   *  undefined when it can't parse or there's no readable text (caller then falls
   *  back to the dependency-free extractor). Best-effort: never throws. */
  private async parseMessage(source?: Buffer): Promise<{
    body?: string;
    headers: HeaderMap;
    inReplyTo?: string;
    references?: string | string[];
  }> {
    if (!source || source.length === 0) return { headers: {} };
    try {
      const parsed = await simpleParser(source);
      const text = (parsed.text ?? '').trim();
      const html = typeof parsed.html === 'string' ? this.stripHtml(parsed.html).trim() : '';
      // Only the plain string headers matter here (auto-submitted, precedence, …);
      // structured ones (addresses, content-type) are parsed objects and are skipped.
      const headers: HeaderMap = {};
      for (const [name, value] of parsed.headers as Map<string, unknown>) {
        if (typeof value === 'string') headers[name.toLowerCase()] = value;
      }
      return {
        body: text || html || undefined,
        headers,
        inReplyTo: parsed.inReplyTo ?? undefined,
        references: parsed.references ?? undefined,
      };
    } catch (e) {
      this.logger.warn(`mailparser failed on an inbound message: ${(e as Error).message}`);
      return { headers: {} };
    }
  }

  /**
   * Which contact an inbound email belongs to.
   *
   * 1. The sender, when it is a contact we know.
   * 2. The thread it answers — In-Reply-To / References against our own outbound
   *    Message-IDs. This is what catches a colleague replying from another address.
   * 3. Otherwise the most recent contact at the same company domain that we have
   *    written to lately. Consumer mailbox domains are excluded, because a shared
   *    domain says nothing about who someone works for.
   */
  private async resolveContact(tenantId: string, from: string, refs: string[]) {
    const direct = await this.prisma.contact.findFirst({
      where: { tenantId, email: { equals: from, mode: 'insensitive' } },
    });
    if (direct) return { contact: direct, via: 'sender' as const };

    if (refs.length) {
      const threaded = await this.prisma.emailMessage.findFirst({
        where: {
          tenantId,
          direction: MessageDirection.OUTBOUND,
          messageId: { in: refs },
          contactId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { contact: true },
      });
      if (threaded?.contact) return { contact: threaded.contact, via: 'thread' as const };
    }

    const domain = domainOf(from);
    if (!domain || isFreeMailDomain(domain)) return null;
    const recent = await this.prisma.emailMessage.findFirst({
      where: {
        tenantId,
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: new Date(Date.now() - DOMAIN_MATCH_DAYS * 86_400_000) },
        contact: { email: { endsWith: `@${domain}`, mode: 'insensitive' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { contact: true },
    });
    return recent?.contact ? { contact: recent.contact, via: 'company domain' as const } : null;
  }

  /** Best-effort, dependency-free extraction of a readable text body from raw
   *  RFC822 source. Walks nested multipart trees (mixed/alternative/related),
   *  decodes quoted-printable / base64, and prefers text/plain, falling back to
   *  stripped HTML. */
  private extractTextBody(raw: string): string {
    const { plain, html } = this.collectText(raw, 0);
    return (plain ?? html ?? '').trim();
  }

  /** Splits a MIME section into [headers, body] at the first blank line. */
  private splitHeaders(s: string): [string, string] {
    const i = s.indexOf('\r\n\r\n') >= 0 ? s.indexOf('\r\n\r\n') : s.indexOf('\n\n');
    if (i < 0) return ['', s];
    return [s.slice(0, i), s.slice(i).replace(/^\r?\n\r?\n/, '')];
  }

  private decodeTransfer(lowerHeaders: string, b: string): string {
    if (/content-transfer-encoding:\s*base64/.test(lowerHeaders)) {
      try {
        return Buffer.from(b.replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {
        return b;
      }
    }
    if (/content-transfer-encoding:\s*quoted-printable/.test(lowerHeaders)) {
      return b
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
    }
    return b;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /** Recursively pulls the best text/plain (and html fallback) out of a MIME
   *  section, descending into nested multipart parts. */
  private collectText(
    section: string,
    depth: number,
  ): { plain?: string; html?: string } {
    if (depth > 8) return {};
    const [headers, body] = this.splitHeaders(section);
    const lower = headers.toLowerCase();
    const ct =
      /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.toLowerCase() ??
      'text/plain';
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];

    if (ct.startsWith('multipart/') && boundary) {
      let plain: string | undefined;
      let html: string | undefined;
      // Skip the preamble (segment 0) and the closing "--boundary--" segment.
      const segments = body.split(`--${boundary}`).slice(1);
      for (const seg of segments) {
        const s = seg.replace(/^\r?\n/, '');
        if (!s || s.startsWith('--')) continue;
        const r = this.collectText(s, depth + 1);
        if (plain === undefined && r.plain !== undefined) plain = r.plain;
        if (html === undefined && r.html !== undefined) html = r.html;
      }
      return { plain, html };
    }

    const decoded = this.decodeTransfer(lower, body);
    if (ct.includes('html')) return { html: this.stripHtml(decoded) };
    if (ct.includes('text/')) return { plain: decoded.trim() };
    return {}; // non-text leaf (attachment, image, …)
  }

  /** Logs a REPLY event against the contact's latest outbound (stops sequence). */
  private async recordReply(contact: { id: string; tenantId: string; email: string }, fromEmail: string) {
    const lastOutbound = await this.prisma.emailMessage.findFirst({
      where: { tenantId: contact.tenantId, contactId: contact.id, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastOutbound) return;

    const existing = await this.prisma.emailEvent.findFirst({
      where: { messageId: lastOutbound.id, eventType: EventType.REPLY },
    });
    // Always flip the contact's active enrollments to REPLIED (stop the
    // sequence + reflect it in the cohort "Replied" count), even if the REPLY
    // event was already recorded.
    await this.prisma.enrollment.updateMany({
      where: { contactId: contact.id, status: EnrollmentStatus.ACTIVE },
      data: { status: EnrollmentStatus.REPLIED },
    });
    if (existing) return;

    await this.prisma.emailEvent.create({
      data: {
        messageId: lastOutbound.id,
        campaignId: lastOutbound.campaignId,
        eventType: EventType.REPLY,
      },
    });
    this.logger.log(
      `Reply detected from ${fromEmail}${fromEmail.toLowerCase() === contact.email.toLowerCase() ? '' : ` (for ${contact.email})`}`,
    );
  }

  private webUrl(): string {
    return (
      this.config.get<string>('WEB_PUBLIC_URL') ||
      this.config.get<string>('CORS_ORIGIN') ||
      'http://localhost:3000'
    );
  }

  /**
   * Emails the client that a reply landed in their mailbox, CC'ing the tenant's
   * admin(s). Sent from the tenant's report mailbox when set, else from the
   * mailbox that received the reply. Best-effort: only fires for client-scoped
   * mailboxes that have a reachable client email.
   */
  private async notifyClientOfReply(
    mailbox: any,
    fromEmail: string,
    subject?: string,
  ): Promise<void> {
    if (!mailbox.clientId) return;
    const client = await this.prisma.client.findUnique({
      where: { id: mailbox.clientId },
      include: { owner: { select: { email: true, name: true } } },
    });
    if (!client) return;
    const clientEmail = client.owner?.email || client.email;
    if (!clientEmail) return;

    // CC the tenant's active super admin(s).
    const admins = await this.prisma.user.findMany({
      where: {
        tenantId: mailbox.tenantId,
        role: Role.SUPER_ADMIN,
        status: 'ACTIVE',
      },
      select: { email: true },
    });
    const cc =
      admins.map((a) => a.email).filter(Boolean).join(', ') || undefined;

    // Prefer the tenant's report mailbox as the "admin side" sender.
    let sender = mailbox;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: mailbox.tenantId },
    });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({
        where: { id: tenant.reportMailboxId },
      });
      if (acct) sender = acct;
    }

    const safeSubject = subject?.trim() || '(no subject)';
    await this.mailer.send({
      account: sender,
      to: clientEmail,
      cc,
      subject: `New reply received — ${client.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#0f766e">You have a new reply</h2>
          <p>A prospect just replied to your outreach for <b>${client.name}</b>.</p>
          <table style="font-size:14px;color:#334155;margin:16px 0">
            <tr><td style="color:#94a3b8;padding-right:12px">From</td><td>${fromEmail}</td></tr>
            <tr><td style="color:#94a3b8;padding-right:12px">Subject</td><td>${safeSubject}</td></tr>
            <tr><td style="color:#94a3b8;padding-right:12px">Mailbox</td><td>${mailbox.emailAddress}</td></tr>
          </table>
          <p style="margin:20px 0">
            <a href="${this.webUrl()}/client"
               style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
              Open your portal
            </a>
          </p>
          <p style="color:#94a3b8;font-size:12px">
            You're receiving this because a reply arrived in your GrapMe mailbox.
          </p>
        </div>`,
    });
    this.logger.log(`Reply alert sent to ${clientEmail} (cc ${cc ?? 'none'})`);
  }

  /** Heuristic: is this inbound message a delivery-failure / bounce (DSN)? */
  private isBounce(from: string, subject?: string): boolean {
    const f = (from || '').toLowerCase();
    if (/mailer-daemon|postmaster|maildelivery|mail-daemon/.test(f)) return true;
    const s = (subject || '').toLowerCase();
    return /undeliver|delivery (status notification|failed|failure|incomplete)|returned mail|failure notice|not delivered|could ?n.?t be delivered|mail delivery (failed|subsystem)/.test(
      s,
    );
  }

  /** Pulls the failed recipient out of a DSN body. */
  private extractBounceRecipient(raw: string): string | null {
    const m =
      /Final-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/i.exec(raw) ||
      /Original-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/i.exec(raw) ||
      /X-Failed-Recipients:\s*<?([^\s,>]+@[^\s,>]+)>?/i.exec(raw);
    if (!m) return null;
    return m[1].toLowerCase().replace(/[<>]/g, '');
  }

  /**
   * DSN handling. Soft/transient failures (4.x.x, greylisting, delayed, quota) are
   * IGNORED so a temporary blip doesn't permanently kill a valid contact. Hard
   * failures (5.x.x / recipient rejected) are suppressed via the shared bounce
   * handler (suppression + contact BOUNCED + stop enrollments + BOUNCE event).
   */
  private async handleBounce(tenantId: string, email: string, raw: string) {
    if (this.isSoftBounce(raw)) {
      this.logger.log(`Soft/transient bounce ignored (not suppressing): ${email}`);
      return;
    }
    await this.bounce.recordHardBounce(tenantId, email, { reason: bounceReason(raw) });
  }

  /** DSN severity: true = transient (4.x.x / delayed / greylist / quota / throttle). */
  private isSoftBounce(raw: string): boolean {
    const status = /Status:\s*([45])\.\d+\.\d+/i.exec(raw);
    if (status) return status[1] === '4'; // machine-readable status: 4=soft, 5=hard
    if (/Action:\s*delayed/i.test(raw)) return true;
    return /(temporar(y|ily)|try again later|greylist|deferred|mailbox is full|mailbox full|over ?quota|quota exceeded|rate limited|resources? temporarily|throttl)/i.test(
      raw,
    );
  }
}

/** Extract a short human-readable bounce reason from a DSN body. */
function bounceReason(raw: string): string | undefined {
  const diag = /Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i.exec(raw);
  if (diag) return diag[1].trim().slice(0, 300);
  const status = /Status:\s*(5\.\d+\.\d+)/i.exec(raw);
  // Common human phrases if no machine code is present.
  const phrase = /((?:550|551|552|553|554)[^\r\n]{0,160})|(user\s+unknown|mailbox\s+(?:not\s+found|unavailable|does\s+not\s+exist)|no\s+such\s+user|recipient\s+(?:address\s+)?rejected|address\s+not\s+found|relay\s+denied|access\s+denied)/i.exec(raw);
  if (phrase) return `${status ? status[1] + ' ' : ''}${(phrase[0] ?? '').trim()}`.trim().slice(0, 300);
  return status ? `Delivery failed (${status[1]})` : undefined;
}
