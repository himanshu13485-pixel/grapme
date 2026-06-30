import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailAccount } from '@prisma/client';
import { decryptCredential } from '../common/crypto/credential-crypto';

export interface SendResult {
  messageId: string;
  accepted: boolean;
}

/** Builds per-mailbox SMTP transports and sends a single message. */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  private buildTransport(account: EmailAccount) {
    const password = decryptCredential(account.credentialsEncrypted);
    return nodemailer.createTransport({
      host: account.smtpHost ?? undefined,
      port: account.smtpPort ?? 587,
      secure: account.smtpSecure ?? false,
      auth: { user: account.smtpUsername || account.emailAddress, pass: password },
    });
  }

  async send(params: {
    account: EmailAccount;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<SendResult> {
    const transport = this.buildTransport(params.account);
    const info = await transport.sendMail({
      from: params.account.emailAddress,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      headers: params.headers,
    });
    this.logger.log(`Sent to ${params.to} via ${params.account.emailAddress}`);
    return {
      messageId: info.messageId,
      accepted: (info.accepted?.length ?? 0) > 0,
    };
  }

  /** Verifies the SMTP handshake without sending. */
  async verify(account: EmailAccount): Promise<boolean> {
    try {
      const transport = this.buildTransport(account);
      await transport.verify();
      return true;
    } catch (err) {
      this.logger.warn(`Verify failed for ${account.emailAddress}: ${err}`);
      return false;
    }
  }
}
