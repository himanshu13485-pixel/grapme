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
import { CreateMailboxDto } from './dto/mailboxes.dto';

// Credentials are never exposed; this projection omits the encrypted blob.
const SAFE = {
  id: true,
  label: true,
  protocol: true,
  emailAddress: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecure: true,
  imapHost: true,
  imapPort: true,
  status: true,
  dailyLimit: true,
  warmupEnabled: true,
  sendSpeedSeconds: true,
  reputationScore: true,
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

  list(user: AuthUser) {
    return this.prisma.emailAccount.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
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
        credentialsEncrypted: encryptCredential(dto.password),
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpSecure: dto.smtpSecure ?? true,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        dailyLimit: dto.dailyLimit ?? 200,
        sendSpeedSeconds: dto.sendSpeedSeconds ?? 90,
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
