import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { ApprovalEntity, ApprovalStatus, MailboxStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { MailerService } from '../sending/mailer.service';
import {
  encryptCredential,
  decryptCredential,
} from '../common/crypto/credential-crypto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { assertClientAccess, resourceClientScope } from '../common/client-scope';
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
  smtpEncryption: true,
  imapHost: true,
  imapPort: true,
  imapEncryption: true,
  imapUsername: true,
  imapAllowSelfSigned: true,
  status: true,
  statusReason: true,
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

  async list(user: AuthUser, clientId?: string) {
    const scope = await resourceClientScope(this.prisma, user, clientId);
    return this.prisma.emailAccount.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
      },
      select: SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creating a mailbox stages it PENDING and opens an SMTP approval. */
  async create(user: AuthUser, dto: CreateMailboxDto) {
    if (user.role === Role.CLIENT) await assertClientAccess(this.prisma, user, dto.clientId);
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
        smtpEncryption: dto.smtpEncryption ?? ((dto.smtpPort === 587 || dto.smtpPort === 25) ? 'STARTTLS' : 'SSL'),
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        imapEncryption: dto.imapEncryption ?? (dto.imapPort === 143 ? 'STARTTLS' : 'SSL'),
        imapUsername: dto.imapUsername,
        imapCredentialsEncrypted: dto.imapPassword
          ? encryptCredential(dto.imapPassword)
          : null,
        imapAllowSelfSigned: dto.imapAllowSelfSigned ?? false,
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

  /**
   * Replicate a mailbox's full configuration (same server, ports, security, caps AND
   * credentials) as a NEW mailbox labelled "(copy)". Staged PENDING with a fresh SMTP
   * approval, exactly like a new mailbox — the admin then edits the email address /
   * username / password for the related address before it goes live.
   */
  async duplicate(user: AuthUser, id: string) {
    const src = await this.getOwned(user, id);
    const account = await this.prisma.emailAccount.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        label: `${src.label} (copy)`,
        protocol: src.protocol,
        emailAddress: src.emailAddress,
        smtpUsername: src.smtpUsername,
        credentialsEncrypted: src.credentialsEncrypted, // same AES blob → same password
        smtpHost: src.smtpHost,
        smtpPort: src.smtpPort,
        smtpSecure: src.smtpSecure,
        smtpEncryption: src.smtpEncryption,
        imapHost: src.imapHost,
        imapPort: src.imapPort,
        imapEncryption: src.imapEncryption,
        imapUsername: src.imapUsername,
        imapCredentialsEncrypted: src.imapCredentialsEncrypted,
        imapAllowSelfSigned: src.imapAllowSelfSigned,
        dailyLimit: src.dailyLimit,
        sendSpeedSeconds: src.sendSpeedSeconds,
        warmupEnabled: src.warmupEnabled,
        clientId: src.clientId,
        rotationOrder: src.rotationOrder,
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
      action: 'DUPLICATE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: account.id,
      after: { copiedFrom: id },
    });
    return account;
  }

  /** Edit a mailbox's details. Password is only replaced when provided. */
  async update(user: AuthUser, id: string, dto: UpdateMailboxDto) {
    const before = await this.getOwned(user, id);

    const data: Record<string, unknown> = {
      label: dto.label,
      protocol: dto.protocol,
      emailAddress: dto.emailAddress,
      smtpUsername: dto.smtpUsername,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      smtpEncryption: dto.smtpEncryption,
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapEncryption: dto.imapEncryption,
      imapUsername: dto.imapUsername,
      imapAllowSelfSigned: dto.imapAllowSelfSigned,
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
    // How the mailbox logs in and where it sends from — what SMTP approval vetted.
    const LOGIN_FIELDS = [
      'protocol', 'emailAddress', 'smtpUsername', 'smtpHost', 'smtpPort', 'smtpSecure',
      'smtpEncryption', 'imapHost', 'imapPort', 'imapEncryption', 'imapUsername', 'imapAllowSelfSigned',
    ] as const;
    const loginChanged =
      !!dto.password ||
      !!dto.imapPassword ||
      LOGIN_FIELDS.some((k) => {
        const v = dto[k as keyof UpdateMailboxDto];
        return v !== undefined && v !== (before as Record<string, unknown>)[k];
      });
    const autoDisabled =
      before.status === MailboxStatus.DISABLED && !!before.statusReason?.startsWith('Auto-disabled');
    // A client changing a mailbox's login (or re-enabling one the bounce breaker
    // disabled) sends it back for SMTP approval; it stops sending until approved.
    // Staff edits re-enable an auto-disabled mailbox directly, as before.
    const needsReview = user.role === Role.CLIENT && (loginChanged || autoDisabled);
    if (needsReview) {
      data.status = MailboxStatus.PENDING;
      data.statusReason = loginChanged
        ? 'Login details changed — awaiting approval'
        : 'Re-enable requested — awaiting approval';
    } else if (autoDisabled) {
      data.status = MailboxStatus.ACTIVE;
      data.statusReason = null;
      // Fresh bounce window: the breaker judges only what it sends from here, so the
      // bounces that disabled it can't immediately disable it again.
      data.bounceWindowFrom = new Date();
    }

    const account = await this.prisma.emailAccount.update({
      where: { id },
      data,
      select: SAFE,
    });
    // Capture only changed, non-secret fields for a clear audit diff.
    const tracked = [
      'label', 'emailAddress', 'protocol', 'smtpHost', 'smtpPort', 'smtpUsername',
      'imapHost', 'imapPort', 'imapUsername', 'imapAllowSelfSigned', 'dailyLimit',
      'sendSpeedSeconds', 'warmupEnabled',
    ] as const;
    const changedBefore: Record<string, unknown> = { label: before.label };
    const changedAfter: Record<string, unknown> = { label: account.label };
    for (const k of tracked) {
      const b = (before as Record<string, unknown>)[k];
      const a = (account as Record<string, unknown>)[k];
      if (dto[k as keyof UpdateMailboxDto] !== undefined && b !== a) {
        changedBefore[k] = b;
        changedAfter[k] = a;
      }
    }
    if (dto.password) changedAfter.password = '(changed)';
    if (dto.imapPassword) changedAfter.imapPassword = '(changed)';
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'UPDATE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: id,
      before: changedBefore,
      after: changedAfter,
    });
    if (needsReview) {
      const open = await this.prisma.approval.count({
        where: { tenantId: user.tenantId, entityType: ApprovalEntity.SMTP, entityId: id, status: ApprovalStatus.PENDING },
      });
      if (!open) {
        await this.approvals.submit({
          tenantId: user.tenantId,
          submittedById: user.userId,
          entityType: ApprovalEntity.SMTP,
          entityId: id,
        });
      }
    }
    return { ...account, pendingApproval: needsReview };
  }

  /**
   * Turn a disabled mailbox back on (staff).
   *
   * Clears the reason and starts a fresh bounce window, so the bounces that disabled it
   * cannot immediately disable it again. Clients ask through the mailbox Edit form
   * instead, which routes the request to admin approval.
   */
  async enable(user: AuthUser, id: string) {
    if (user.role === Role.CLIENT) {
      throw new ForbiddenException('Ask your account manager to re-enable this mailbox.');
    }
    const before = await this.prisma.emailAccount.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!before) throw new NotFoundException('Mailbox not found');
    if (before.status === MailboxStatus.ACTIVE) return this.prisma.emailAccount.findUnique({ where: { id }, select: SAFE });

    const account = await this.prisma.emailAccount.update({
      where: { id },
      data: { status: MailboxStatus.ACTIVE, statusReason: null, bounceWindowFrom: new Date() },
      select: SAFE,
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'ENABLE_MAILBOX',
      entityType: 'EmailAccount',
      entityId: id,
      before: { label: before.label, status: before.status, statusReason: before.statusReason },
      after: { label: before.label, status: MailboxStatus.ACTIVE },
    });
    return account;
  }

  /** Tenant-wide bounce ceiling the circuit breaker enforces. */
  async getBouncePolicy(user: AuthUser) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { bounceMaxRatePct: true },
    });
    return { maxRatePct: t?.bounceMaxRatePct ?? 7 };
  }

  async setBouncePolicy(user: AuthUser, maxRatePct: number) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
    const pct = Math.floor(Number(maxRatePct));
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      throw new BadRequestException('Enter a bounce limit between 1 and 100%.');
    }
    const before = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { bounceMaxRatePct: true },
    });
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { bounceMaxRatePct: pct } });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'SET_BOUNCE_POLICY',
      entityType: 'Tenant',
      entityId: user.tenantId,
      before: { bounceMaxRatePct: before?.bounceMaxRatePct ?? 7 },
      after: { bounceMaxRatePct: pct },
    });
    return { maxRatePct: pct };
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

  /**
   * Real IMAP receiving test: connects to the mailbox's IMAP server with the
   * stored credentials, opens INBOX, and reports how many recent messages it
   * can see (last 7 days) plus the latest few. Surfaces the exact error on
   * failure so misconfiguration is obvious. Read-only — does not store anything.
   */
  async testImap(user: AuthUser, id: string) {
    const account = await this.getOwned(user, id);

    const pollerEligible =
      account.status === MailboxStatus.ACTIVE && !!account.imapHost;

    if (!account.imapHost) {
      return {
        ok: false,
        pollerEligible,
        detail:
          'No IMAP host configured for this mailbox — the reply poller skips it. Add IMAP host/port/username/password in the mailbox settings.',
      };
    }

    const user_ = account.imapUsername || account.emailAddress;
    let client: ImapFlow | null = null;
    try {
      client = new ImapFlow({
        host: account.imapHost,
        port: account.imapPort ?? 993,
        secure: true,
        auth: {
          user: user_,
          pass: decryptCredential(
            account.imapCredentialsEncrypted ?? account.credentialsEncrypted,
          ),
        },
        tls: account.imapAllowSelfSigned
          ? { rejectUnauthorized: false }
          : undefined,
        logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const found = await client.search({ since }, { uid: true });
        const uids = Array.isArray(found) ? found : [];
        const recent = uids.slice(-10).reverse();
        const latest: { from?: string; subject?: string; date?: string }[] = [];
        if (recent.length) {
          for await (const msg of client.fetch(
            recent,
            { envelope: true },
            { uid: true },
          )) {
            latest.push({
              from: msg.envelope?.from?.[0]?.address,
              subject: msg.envelope?.subject ?? undefined,
              date: msg.envelope?.date
                ? new Date(msg.envelope.date).toISOString()
                : undefined,
            });
          }
        }
        return {
          ok: true,
          pollerEligible,
          host: account.imapHost,
          port: account.imapPort ?? 993,
          username: user_,
          recentCount: uids.length,
          latest,
          detail: pollerEligible
            ? `Connected. ${uids.length} message(s) in the last 7 days. The reply poller checks this mailbox every few minutes.`
            : `Connected, but the mailbox status is "${account.status}" — the reply poller only polls ACTIVE mailboxes, so set it Active to capture replies automatically.`,
        };
      } finally {
        lock.release();
      }
    } catch (err) {
      return {
        ok: false,
        pollerEligible,
        host: account.imapHost,
        port: account.imapPort ?? 993,
        username: user_,
        detail: `IMAP connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async getOwned(user: AuthUser, id: string) {
    // Admins/sub-admins manage every mailbox in the tenant (the workspace lists them
    // all, regardless of who created it). Non-admins are restricted to their own.
    const isAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.SUB_ADMIN;
    const account = await this.prisma.emailAccount.findFirst({
      where: { id, tenantId: user.tenantId, ...(isAdmin ? {} : { userId: user.userId }) },
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
