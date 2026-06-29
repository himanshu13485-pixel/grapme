import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalEntity, MailboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { MailerService } from '../sending/mailer.service';
import {
  encryptCredential,
  decryptCredential,
} from '../common/crypto/credential-crypto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateMailboxDto,
  SendTestEmailDto,
  UpdateMailboxDto,
} from './dto/mailboxes.dto';

// Credentials are never exposed; this projection omits the encrypted blob.
const SAFE = {
  id: true,
  label: true,
  protocol: true,
  emailAddress: true,
  smtpUsername: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecure: true,
  imapHost: true,
  imapPort: true,
  imapUsername: true,
  status: true,
  dailyLimit: true,
  warmupEnabled: true,
  sendSpeedSeconds: true,
  reputationScore: true,
  clientId: true,
  rotationOrder: true,
  createdAt: true,
} as const;

@Injectable()
export class MailboxesService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private activity: ActivityService,
    private mailer: MailerService,
  ) {}

  list(user: AuthUser, clientId?: string) {
    return this.prisma.emailAccount.findMany({
      where: {
        tenantId: user.tenantId,
        ...(clientId ? { clientId } : {}),
      },
      select: SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creating a mailbox stages it PENDING and opens an SMTP approval. */
  async create(user: AuthUser, dto: CreateMailboxDto) {
    const account = await this.prisma.emailAccount.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        label: dto.label,
        protocol: dto.protocol,
        emailAddress: dto.emailAddress,
        smtpUsername: dto.smtpUsername,
        credentialsEncrypted: encryptCredential(dto.password),
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpSecure: dto.smtpSecure ?? true,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        imapUsername: dto.imapUsername,
        imapCredentialsEncrypted: dto.imapPassword
          ? encryptCredential(dto.imapPassword)
          : null,
        dailyLimit: dto.dailyLimit ?? 200,
        sendSpeedSeconds: dto.sendSpeedSeconds ?? 90,
        clientId: dto.clientId || null,
        rotationOrder: dto.rotationOrder ?? 0,
        status: MailboxStatus.PENDING,
      },
      select: SAFE,
    });

    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.SMTP,
      entityId: account.id,
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'CREATE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: account.id,
    });
    return account;
  }

  /** Edit a mailbox's details. Password is only replaced when provided. */
  async update(user: AuthUser, id: string, dto: UpdateMailboxDto) {
    await this.getOwned(user, id);

    const data: Record<string, unknown> = {
      label: dto.label,
      protocol: dto.protocol,
      emailAddress: dto.emailAddress,
      smtpUsername: dto.smtpUsername,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapUsername: dto.imapUsername,
      dailyLimit: dto.dailyLimit,
      sendSpeedSeconds: dto.sendSpeedSeconds,
      warmupEnabled: dto.warmupEnabled,
    };
    if (dto.password) {
      data.credentialsEncrypted = encryptCredential(dto.password);
    }
    if (dto.imapPassword) {
      data.imapCredentialsEncrypted = encryptCredential(dto.imapPassword);
    }

    const account = await this.prisma.emailAccount.update({
      where: { id },
      data,
      select: SAFE,
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'UPDATE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: id,
    });
    return account;
  }

  /** Delete a mailbox. Campaign/message references are set null (schema). */
  async remove(user: AuthUser, id: string) {
    await this.getOwned(user, id);
    await this.prisma.emailAccount.delete({ where: { id } });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'DELETE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: id,
    });
    return { ok: true };
  }

  /**
   * Lightweight connection test. Returns a verdict without persisting.
   * A real SMTP/IMAP handshake is wired in the sending-engine phase; here we
   * validate the shape so the UI can surface obvious misconfigurations.
   */
  async testConnection(user: AuthUser, id: string) {
    const account = await this.getOwned(user, id);
    if (!account.smtpHost || !account.smtpPort) {
      return {
        mailboxId: id,
        reachable: false,
        detail: 'Missing SMTP host/port.',
      };
    }
    const ok = await this.mailer.verify(account);
    return {
      mailboxId: id,
      reachable: ok,
      detail: ok
        ? 'SMTP handshake succeeded.'
        : 'SMTP handshake failed — check host, port, and app-password.',
    };
  }

  /** Sends a single real test email from this mailbox to verify delivery. */
  async sendTest(user: AuthUser, id: string, dto: SendTestEmailDto) {
    const account = await this.getOwned(user, id);
    if (!account.smtpHost || !account.smtpPort) {
      return { sent: false, detail: 'Missing SMTP host/port.' };
    }

    const subject = dto.subject?.trim() || 'AEO test email';
    const body =
      dto.body?.trim() ||
      `<p>This is a test email from <strong>${account.label}</strong> ` +
        `(${account.emailAddress}) sent via AEO.</p>` +
        `<p>If you received this, the mailbox can send successfully.</p>`;

    try {
      const result = await this.mailer.send({
        account,
        to: dto.to,
        subject,
        html: body,
        headers: { 'X-AEO-Test': '1' },
      });
      await this.activity.log({
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'SEND_TEST_EMAIL',
        entityType: 'EmailAccount',
        entityId: id,
        after: { to: dto.to, messageId: result.messageId },
      });
      return {
        sent: result.accepted,
        detail: result.accepted
          ? `Test email sent to ${dto.to}.`
          : `Server did not accept the message for ${dto.to}.`,
        messageId: result.messageId,
      };
    } catch (err) {
      return {
        sent: false,
        detail: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async getOwned(user: AuthUser, id: string) {
    const account = await this.prisma.emailAccount.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.userId },
    });
    if (!account) throw new NotFoundException('Mailbox not found');
    return account;
  }

  /** Internal use by the sending worker only. */
  async resolveCredential(id: string): Promise<string> {
    const account = await this.prisma.emailAccount.findUnique({
      where: { id },
    });
    if (!account) throw new NotFoundException('Mailbox not found');
    return decryptCredential(account.credentialsEncrypted);
  }
}
