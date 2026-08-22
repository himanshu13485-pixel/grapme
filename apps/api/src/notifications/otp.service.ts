import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PortalService } from './portal.service';
import { MESSAGING_CHANNELS, MessagingChannel, channelMeta } from './channels';

export interface OtpResult {
  ok: boolean;
  error?: string;
  retryAfter?: number;
}

/**
 * Issues and checks the one-time codes that verify a user's address on a
 * messaging channel.
 *
 * Only a hash of the code is stored; the plain code exists only in the message
 * we send. Codes expire, are single-use, and allow a limited number of guesses.
 *
 * Verification is per channel even where the address is the same. Reaching
 * someone on WhatsApp is no evidence they are on Telegram — and on Telegram a
 * number is only reachable at all if that person allows being found by it — so
 * each network has to prove itself before we send alerts there. Netvork shares
 * an address with neither: it is an App ID, and the code arriving proves both
 * that the ID is theirs and that our sending account is allowed to message
 * them, which on Netvork is a permission of its own.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  /** How long a code stays valid. */
  static readonly TTL_MINUTES = 10;

  /** Wrong guesses allowed before the code is burned. */
  static readonly MAX_ATTEMPTS = 5;

  /** Minimum gap between sends, to stop resend-spamming. */
  static readonly RESEND_COOLDOWN_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: PortalService,
  ) {}

  /** The user's address on this channel and whether it's already verified. */
  async status(userId: string, channel: MessagingChannel) {
    const meta = channelMeta(channel);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        contactMobile: true,
        netvorkAppId: true,
        tenantId: true,
        whatsappVerifiedAt: true,
        telegramVerifiedAt: true,
        netvorkVerifiedAt: true,
        notifyWhatsapp: true,
        notifyTelegram: true,
        notifyNetvork: true,
      },
    });

    const verifiedAt = user?.[meta.verifiedField] ?? null;

    return {
      channel,
      label: meta.label,
      address: user?.[meta.addressField] ?? null,
      addressLabel: meta.addressLabel,
      verified: !!verifiedAt,
      verifiedAt,
      notify: !!user?.[meta.notifyField],
      cooldown: await this.cooldownRemaining(userId, channel),
      configured: await this.portal.isConfigured(user?.tenantId, channel),
    };
  }

  /** Every channel's state at once, for a settings screen that shows them all. */
  async statusAll(userId: string) {
    const all = await Promise.all(MESSAGING_CHANNELS.map((c) => this.status(userId, c)));

    return Object.fromEntries(all.map((one) => [one.channel, one])) as Record<
      MessagingChannel,
      Awaited<ReturnType<OtpService['status']>>
    >;
  }

  /** Generate a code and send it to the user on this channel. */
  async issue(userId: string, channel: MessagingChannel): Promise<OtpResult> {
    const meta = channelMeta(channel);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { contactMobile: true, netvorkAppId: true, tenantId: true },
    });
    const address = user?.[meta.addressField]?.trim();

    if (!address) {
      return { ok: false, error: `No ${meta.addressLabel} on this account. Add one to your profile first.` };
    }

    // Resolved up front so the message carries the workspace's own brand name.
    const cfg = await this.portal.configFor(user?.tenantId, channel);
    if (!cfg) {
      return { ok: false, error: `${meta.label} is not set up for this workspace yet.` };
    }

    const wait = await this.cooldownRemaining(userId, channel);
    if (wait > 0) {
      return { ok: false, error: `Please wait ${wait} seconds before requesting another code.`, retryAfter: wait };
    }

    const code = String(randomInt(100000, 1000000));

    // Any earlier code for this user *on this channel* is void the moment a new
    // one is issued. A pending WhatsApp code must survive starting a Telegram one.
    await this.prisma.channelVerification.deleteMany({ where: { userId, channel } });

    const verification = await this.prisma.channelVerification.create({
      data: {
        userId,
        channel,
        address,
        codeHash: await argon2.hash(code, { type: argon2.argon2id }),
        expiresAt: new Date(Date.now() + OtpService.TTL_MINUTES * 60_000),
      },
    });

    const res = await this.portal.send(
      user?.tenantId,
      channel,
      address,
      this.messageFor(code, cfg.brand, meta.label, meta.addressLabel),
    );

    if (!res.ok) {
      // Don't leave a code the user can never receive.
      await this.prisma.channelVerification.delete({ where: { id: verification.id } }).catch(() => undefined);
      return { ok: false, error: res.error ?? 'Could not send the code.' };
    }

    return { ok: true };
  }

  /** Check a submitted code and mark the number verified on this channel. */
  async verify(userId: string, channel: MessagingChannel, code: string): Promise<OtpResult> {
    const meta = channelMeta(channel);
    const verification = await this.prisma.channelVerification.findFirst({
      where: { userId, channel },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      return { ok: false, error: 'No code has been sent. Request a new one.' };
    }

    const drop = () =>
      this.prisma.channelVerification.delete({ where: { id: verification.id } }).catch(() => undefined);

    if (verification.expiresAt.getTime() < Date.now()) {
      await drop();
      return { ok: false, error: 'That code has expired. Request a new one.' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { contactMobile: true, netvorkAppId: true },
    });

    // The address changed since the code was sent — the code no longer applies.
    if ((user?.[meta.addressField] ?? null) !== verification.address) {
      await drop();
      return { ok: false, error: `Your ${meta.addressLabel} changed. Request a new code.` };
    }

    if (verification.attempts >= OtpService.MAX_ATTEMPTS) {
      await drop();
      return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
    }

    const matches = await argon2
      .verify(verification.codeHash, String(code ?? '').trim())
      .catch(() => false);

    if (!matches) {
      const updated = await this.prisma.channelVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = Math.max(0, OtpService.MAX_ATTEMPTS - updated.attempts);

      return { ok: false, error: `That code is not correct. ${left} attempt(s) left.` };
    }

    // Verifying is the user's consent to be messaged on that network, so switch
    // its alerts on. Without this the preference stays at its `false` default and
    // the user would hear nothing after verifying. They can still opt out later,
    // and opting in to one channel says nothing about the other.
    await this.prisma.user.update({
      where: { id: userId },
      data: { [meta.verifiedField]: new Date(), [meta.notifyField]: true },
    });
    await drop();

    return { ok: true };
  }

  /** Seconds the user must wait before another code can be sent on this channel, or 0. */
  async cooldownRemaining(userId: string, channel: MessagingChannel): Promise<number> {
    const last = await this.prisma.channelVerification.findFirst({
      where: { userId, channel },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return 0;

    const elapsed = Math.floor((Date.now() - last.createdAt.getTime()) / 1000);

    return Math.max(0, OtpService.RESEND_COOLDOWN_SECONDS - elapsed);
  }

  private messageFor(code: string, brand: string, network: string, addressLabel: string): string {
    const ttl = OtpService.TTL_MINUTES;

    return (
      `${code} is your ${brand} verification code.\n\n` +
      `It confirms this ${network} ${addressLabel} for alerts, and expires in ${ttl} minutes. ` +
      `If you didn't request this, you can ignore this message.`
    );
  }
}
