import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ImapFlow } from 'imapflow';
import { EventType, MailboxStatus } from '@prisma/client';
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
        user: mailbox.emailAddress,
        pass: decryptCredential(mailbox.credentialsEncrypted),
      },
      logger: false,
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for await (const msg of client.fetch(
          { since },
          { envelope: true },
        )) {
          const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
          if (!from) continue;
          await this.recordReply(mailbox.tenantId, from);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
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
