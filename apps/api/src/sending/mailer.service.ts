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
    const port = account.smtpPort ?? 587;
    // Encryption mode is chosen explicitly (SSL = implicit TLS, STARTTLS = upgrade on
    // a plaintext port, NONE = no encryption). Legacy rows fall back to the boolean.
    const mode = account.smtpEncryption || (account.smtpSecure ? 'SSL' : 'STARTTLS');
    const secure = mode === 'SSL';
    return nodemailer.createTransport({
      host: account.smtpHost ?? undefined,
      port,
      secure,
      requireTLS: mode === 'STARTTLS', // enforce the STARTTLS upgrade so mail stays encrypted
      ignoreTLS: mode === 'NONE',
      auth: { user: account.smtpUsername || account.emailAddress, pass: password },
      tls: { minVersion: 'TLSv1.2' },
    });
  }

  async send(params: {
    account: EmailAccount;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  }): Promise<SendResult> {
    const transport = this.buildTransport(params.account);
    const info = await transport.sendMail({
      from: params.account.emailAddress,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      headers: params.headers,
      attachments: params.attachments,
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
