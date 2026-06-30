import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ImapFlow } from 'imapflow';
import {
  EventType,
  MailboxStatus,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCredential } from '../common/crypto/credential-crypto';
import { QUEUE_REPLIES } from '../queue/queue.constants';

/**
 * Polls each active IMAP-capable mailbox for recent inbound mail and records a
 * REPLY event against the matching contact's most recent outbound message.
 * Best-effort: failures on one mailbox don't stop the others.
 */
@Processor(QUEUE_REPLIES)
export class RepliesProcessor extends WorkerHost {
  private readonly logger = new Logger(RepliesProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
    const mailboxes = await this.prisma.emailAccount.findMany({
      where: { status: MailboxStatus.ACTIVE, imapHost: { not: null } },
    });
    for (const mailbox of mailboxes) {
      try {
        await this.pollMailbox(mailbox);
      } catch (err) {
        this.logger.warn(`IMAP poll failed for ${mailbox.emailAddress}: ${err}`);
      }
    }
  }

  private async pollMailbox(mailbox: any) {
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
      logger: false,
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });
        if (uids && uids.length) {
          for await (const msg of client.fetch(
            uids,
            { envelope: true, source: true },
            { uid: true },
          )) {
            const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
            if (!from) continue;
            const subject = msg.envelope?.subject ?? undefined;
            // Stable de-dupe key: real Message-ID, else from|subject|date.
            const dedupeId =
              msg.envelope?.messageId ??
              `${from}|${subject ?? ''}|${msg.envelope?.date ?? ''}`;
            const body = msg.source
              ? this.extractTextBody(msg.source.toString('utf8'))
              : undefined;
            await this.storeInbound(mailbox, from, subject, dedupeId, body);
            await this.recordReply(mailbox.tenantId, from);
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  /** Persists an inbound email so it appears in the Inbox view (de-duped). */
  private async storeInbound(
    mailbox: any,
    from: string,
    subject: string | undefined,
    dedupeId: string,
    body?: string,
  ) {
    const existing = await this.prisma.emailMessage.findFirst({
      where: {
        tenantId: mailbox.tenantId,
        direction: MessageDirection.INBOUND,
        messageId: dedupeId,
      },
    });
    if (existing) return;

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
        subject,
        body: body ? body.slice(0, 20000) : null,
      },
    });
    this.logger.log(`Inbound stored from ${from}`);
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

    // De-dupe: only one REPLY per outbound message.
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
