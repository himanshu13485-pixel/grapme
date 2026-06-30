import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import {
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCredential } from '../common/crypto/credential-crypto';

/**
 * Pulls inbound mail (replies) from each IMAP-capable mailbox and records it.
 * Used both by the background reply-poll worker and by the on-demand "Sync now"
 * button, so the two always behave identically.
 */
@Injectable()
export class InboundMailService {
  private readonly logger = new Logger(InboundMailService.name);

  constructor(private prisma: PrismaService) {}

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
    const client = new ImapFlow({
      host: mailbox.imapHost,
      port: mailbox.imapPort ?? 993,
      secure: true,
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
            const body = msg.source
              ? this.extractTextBody(msg.source.toString('utf8'))
              : undefined;
            const isNew = await this.storeInbound(
              mailbox,
              from,
              subject,
              dedupeId,
              body,
              receivedAt,
            );
            if (isNew) {
              stored++;
              await this.recordReply(mailbox.tenantId, from);
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
  ): Promise<boolean> {
    const existing = await this.prisma.emailMessage.findFirst({
      where: {
        tenantId: mailbox.tenantId,
        direction: MessageDirection.INBOUND,
        messageId: dedupeId,
      },
    });
    if (existing) return false;

    const contact = await this.prisma.contact.findFirst({
      where: {
        tenantId: mailbox.tenantId,
        email: { equals: from, mode: 'insensitive' },
      },
    });

    await this.prisma.emailMessage.create({
      data: {
        tenantId: mailbox.tenantId,
        emailAccountId: mailbox.id,
        contactId: contact?.id ?? null,
        direction: MessageDirection.INBOUND,
        status: MessageStatus.DELIVERED,
        messageId: dedupeId,
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

  /** Best-effort, dependency-free extraction of a readable text body from raw
   *  RFC822 source. Handles single-part and multipart/alternative, plus
   *  quoted-printable / base64 transfer encodings; falls back to stripped HTML. */
  private extractTextBody(raw: string): string {
    const splitHeaders = (s: string): [string, string] => {
      const i = s.indexOf('\r\n\r\n') >= 0 ? s.indexOf('\r\n\r\n') : s.indexOf('\n\n');
      if (i < 0) return ['', s];
      return [s.slice(0, i), s.slice(i).replace(/^\r?\n\r?\n/, '')];
    };
    const decode = (lowerHeaders: string, b: string): string => {
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
    };
    const stripHtml = (html: string): string =>
      html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    const [headers, body] = splitHeaders(raw);
    const lower = headers.toLowerCase();
    const ct = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.toLowerCase() ?? 'text/plain';
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];

    if (ct.startsWith('multipart/') && boundary) {
      let plain: string | null = null;
      let html: string | null = null;
      for (const part of body.split(`--${boundary}`)) {
        const [ph, pb] = splitHeaders(part);
        const pl = ph.toLowerCase();
        if (!pl.includes('text/')) continue;
        const decoded = decode(pl, pb);
        if (pl.includes('text/plain') && plain == null) plain = decoded;
        else if (pl.includes('text/html') && html == null) html = decoded;
      }
      return (plain ?? (html ? stripHtml(html) : '')).trim();
    }
    const decoded = decode(lower, body);
    return (ct.includes('html') ? stripHtml(decoded) : decoded).trim();
  }

  /** Logs a REPLY event against the contact's latest outbound (stops sequence). */
  private async recordReply(tenantId: string, fromEmail: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, email: { equals: fromEmail, mode: 'insensitive' } },
    });
    if (!contact) return;

    const lastOutbound = await this.prisma.emailMessage.findFirst({
      where: { tenantId, contactId: contact.id, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastOutbound) return;

    const existing = await this.prisma.emailEvent.findFirst({
      where: { messageId: lastOutbound.id, eventType: EventType.REPLY },
    });
    if (existing) return;

    await this.prisma.emailEvent.create({
      data: {
        messageId: lastOutbound.id,
        campaignId: lastOutbound.campaignId,
        eventType: EventType.REPLY,
      },
    });
    this.logger.log(`Reply detected from ${fromEmail}`);
  }
}
