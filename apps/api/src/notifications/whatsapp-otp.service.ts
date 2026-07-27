import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappPortalService } from './whatsapp-portal.service';

export interface OtpResult {
  ok: boolean;
  error?: string;
  retryAfter?: number;
}

/**
 * Issues and checks the one-time codes that verify a user's WhatsApp number.
 *
 * Only a hash of the code is stored; the plain code exists only in the message
 * we send. Codes expire, are single-use, and allow a limited number of guesses.
 */
@Injectable()
export class WhatsappOtpService {
  private readonly logger = new Logger(WhatsappOtpService.name);

  /** How long a code stays valid. */
  static readonly TTL_MINUTES = 10;

  /** Wrong guesses allowed before the code is burned. */
  static readonly MAX_ATTEMPTS = 5;

  /** Minimum gap between sends, to stop resend-spamming. */
  static readonly RESEND_COOLDOWN_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: WhatsappPortalService,
  ) {}

  /** The user's WhatsApp number and whether it's already verified. */
  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { contactMobile: true, whatsappVerifiedAt: true, notifyWhatsapp: true, tenantId: true },
    });

    return {
      phone: user?.contactMobile ?? null,
      verified: !!user?.whatsappVerifiedAt,
      verifiedAt: user?.whatsappVerifiedAt ?? null,
      notifyWhatsapp: !!user?.notifyWhatsapp,
      cooldown: await this.cooldownRemaining(userId),
      configured: await this.portal.isConfigured(user?.tenantId),
    };
  }

  /** Generate a code and WhatsApp it to the user. */
  async issue(userId: string): Promise<OtpResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { contactMobile: true, tenantId: true },
    });
    const phone = user?.contactMobile?.trim();

    if (!phone) {
      return { ok: false, error: 'No WhatsApp number on this account. Add one to your profile first.' };
    }

    // Resolved up front so the message carries the workspace's own brand name.
    const cfg = await this.portal.configFor(user?.tenantId);
    if (!cfg) {
      return { ok: false, error: 'WhatsApp is not set up for this workspace yet.' };
    }

    const wait = await this.cooldownRemaining(userId);
    if (wait > 0) {
      return { ok: false, error: `Please wait ${wait} seconds before requesting another code.`, retryAfter: wait };
    }

    const code = String(randomInt(100000, 1000000));

    // Any earlier code for this user is void the moment a new one is issued.
    await this.prisma.whatsappVerification.deleteMany({ where: { userId } });

    const verification = await this.prisma.whatsappVerification.create({
      data: {
        userId,
        phone,
        codeHash: await argon2.hash(code, { type: argon2.argon2id }),
        expiresAt: new Date(Date.now() + WhatsappOtpService.TTL_MINUTES * 60_000),
      },
    });

    const res = await this.portal.send(user?.tenantId, phone, this.messageFor(code, cfg.brand));

    if (!res.ok) {
      // Don't leave a code the user can never receive.
      await this.prisma.whatsappVerification.delete({ where: { id: verification.id } }).catch(() => undefined);
      return { ok: false, error: res.error ?? 'Could not send the code.' };
    }

    return { ok: true };
  }

  /** Check a submitted code and mark the number verified on success. */
  async verify(userId: string, code: string): Promise<OtpResult> {
    const verification = await this.prisma.whatsappVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      return { ok: false, error: 'No code has been sent. Request a new one.' };
    }

    const drop = () =>
      this.prisma.whatsappVerification.delete({ where: { id: verification.id } }).catch(() => undefined);

    if (verification.expiresAt.getTime() < Date.now()) {
      await drop();
      return { ok: false, error: 'That code has expired. Request a new one.' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { contactMobile: true },
    });

    // The number changed since the code was sent — the code no longer applies.
    if ((user?.contactMobile ?? null) !== verification.phone) {
      await drop();
      return { ok: false, error: 'Your WhatsApp number changed. Request a new code.' };
    }

    if (verification.attempts >= WhatsappOtpService.MAX_ATTEMPTS) {
      await drop();
      return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
    }

    const matches = await argon2
      .verify(verification.codeHash, String(code ?? '').trim())
      .catch(() => false);

    if (!matches) {
      const updated = await this.prisma.whatsappVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = Math.max(0, WhatsappOtpService.MAX_ATTEMPTS - updated.attempts);

      return { ok: false, error: `That code is not correct. ${left} attempt(s) left.` };
    }

    // Verifying the number is the user's consent to be messaged on it, so switch
    // alerts on. Without this the preference stays at its `false` default and the
    // user would hear nothing after verifying. They can still opt out in settings.
    await this.prisma.user.update({
      where: { id: userId },
      data: { whatsappVerifiedAt: new Date(), notifyWhatsapp: true },
    });
    await drop();

    return { ok: true };
  }

  /** Seconds the user must wait before another code can be sent, or 0. */
  async cooldownRemaining(userId: string): Promise<number> {
    const last = await this.prisma.whatsappVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return 0;

    const elapsed = Math.floor((Date.now() - last.createdAt.getTime()) / 1000);

    return Math.max(0, WhatsappOtpService.RESEND_COOLDOWN_SECONDS - elapsed);
  }

  private messageFor(code: string, brand: string): string {
    const ttl = WhatsappOtpService.TTL_MINUTES;

    return (
      `${code} is your ${brand} verification code.\n\n` +
      `It expires in ${ttl} minutes. If you didn't request this, you can ignore this message.`
    );
  }
}
