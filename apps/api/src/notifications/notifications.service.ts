import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { encryptCredential } from '../common/crypto/credential-crypto';
import { PortalService } from './portal.service';
import { MESSAGING_CHANNELS, MessagingChannel, channelMeta } from './channels';

/** What an admin can edit. `apiKey` is write-only — it never comes back out. */
export interface ChannelSettingsDto {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  /** New key to store. Blank/omitted = keep the saved one. */
  apiKey?: string;
  /** Explicitly forget the saved key (blank apiKey means "unchanged", not "clear"). */
  clearApiKey?: boolean;
}

/** What the settings page renders. Never includes the key itself. */
export interface ChannelSettingsView {
  channel: MessagingChannel;
  label: string;
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  /** Masked tail of the saved key, e.g. "••••a3f9", or '' when none is saved. */
  apiKeyHint: string;
  /** True once this workspace has its own portal URL + key saved. */
  workspaceConfigured: boolean;
  /** True when this channel's env vars exist as a fallback. */
  envConfigured: boolean;
  /** Whether sending actually works right now, from either source. */
  active: boolean;
  /** Which credentials are live: 'workspace' | 'env' | 'none'. */
  source: 'workspace' | 'env' | 'none';
}

/** Stored under `Tenant.settings.<channel>`. The key is encrypted at rest. */
interface StoredChannel {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  apiKeyEnc?: string;
  apiKeyHint?: string;
}

const DEFAULTS: StoredChannel = { enabled: false, portalUrl: '', businessName: '', note: '' };

/**
 * Per-workspace messaging settings, one set per channel.
 *
 * Each channel is its own portal project with its own number and API key, so
 * they are configured, tested and switched on independently — a workspace can
 * run WhatsApp only, Telegram only, or both.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: PortalService,
  ) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) throw new ForbiddenException('Admins only');
  }

  /** Every channel's settings, for a screen that shows them side by side. */
  async getAll(user: AuthUser): Promise<ChannelSettingsView[]> {
    return Promise.all(MESSAGING_CHANNELS.map((c) => this.get(user, c)));
  }

  async get(user: AuthUser, channel: MessagingChannel): Promise<ChannelSettingsView> {
    return this.view(user.tenantId, channel, await this.stored(user.tenantId, channel));
  }

  async set(user: AuthUser, channel: MessagingChannel, dto: Partial<ChannelSettingsDto>): Promise<ChannelSettingsView> {
    this.assertAdmin(user);

    const current = await this.stored(user.tenantId, channel);
    const next: StoredChannel = {
      enabled: !!dto.enabled,
      // Store the URL bare — the send path appends /api/v1/..., so a pasted
      // trailing slash or a full endpoint URL would otherwise break every call.
      portalUrl: (dto.portalUrl ?? '').trim().replace(/\/+$/, ''),
      businessName: (dto.businessName ?? '').trim(),
      note: (dto.note ?? '').trim(),
      apiKeyEnc: current.apiKeyEnc,
      apiKeyHint: current.apiKeyHint,
    };

    const key = (dto.apiKey ?? '').trim();
    if (dto.clearApiKey) {
      delete next.apiKeyEnc;
      delete next.apiKeyHint;
    } else if (key) {
      // Encrypted with the same key as mailbox passwords (CREDENTIAL_ENCRYPTION_KEY).
      next.apiKeyEnc = encryptCredential(key);
      next.apiKeyHint = `••••${key.slice(-4)}`;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) ?? {};

    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { settings: { ...settings, [channelMeta(channel).settingsKey]: next } as object },
    });

    return this.view(user.tenantId, channel, next);
  }

  /** Ask the portal whether the saved credentials work and the account is linked. */
  async test(user: AuthUser, channel: MessagingChannel) {
    this.assertAdmin(user);

    return this.portal.status(user.tenantId, channel);
  }

  /**
   * Send a real message, to the admin asking for it and nobody else.
   *
   * Checking the credentials proves we can reach the service; it does not
   * prove a message reaches a person, which is the only thing anyone actually
   * wants to know. Everything between the two — the address being right, the
   * network accepting it, the phone lighting up — is exactly where this has
   * gone wrong before.
   *
   * To themselves deliberately. A button that sends to somebody else is a
   * button that eventually sends to everybody.
   */
  async sendTest(user: AuthUser, channel: MessagingChannel) {
    this.assertAdmin(user);

    const meta = channelMeta(channel);
    const me = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        name: true,
        tenantId: true,
        contactMobile: true,
        netvorkAppId: true,
        whatsappVerifiedAt: true,
        telegramVerifiedAt: true,
        netvorkVerifiedAt: true,
      },
    });

    const address = me?.[meta.addressField]?.trim();
    if (!address) {
      return { ok: false, error: `Add your ${meta.addressLabel} under My Account first.` };
    }

    // The same rule the alerts themselves follow. A test that ignored it would
    // pass on an address the real thing refuses to send to.
    if (!me?.[meta.verifiedField]) {
      return { ok: false, error: `Verify your ${meta.addressLabel} for ${meta.label} first — the test follows the same rule as the alerts.` };
    }

    const res = await this.portal.send(
      me.tenantId,
      channel,
      address,
      `Test message from ${(await this.portal.configFor(me.tenantId, channel))?.brand ?? 'GrapMe'}. If you are reading this, ${meta.label} alerts are working.`,
    );

    return res.ok
      ? { ok: true, sentTo: address }
      : { ok: false, error: res.error ?? 'Could not send the test message.' };
  }

  // -- internals ----------------------------------------------------------

  private async stored(tenantId: string, channel: MessagingChannel): Promise<StoredChannel> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const key = channelMeta(channel).settingsKey;
    const saved = ((tenant?.settings as Record<string, unknown>)?.[key] ?? {}) as Partial<StoredChannel>;

    return { ...DEFAULTS, ...saved };
  }

  private async view(tenantId: string, channel: MessagingChannel, w: StoredChannel): Promise<ChannelSettingsView> {
    const workspaceConfigured = !!w.portalUrl && !!w.apiKeyEnc;
    const live = await this.portal.configFor(tenantId, channel);

    return {
      channel,
      label: channelMeta(channel).label,
      enabled: w.enabled,
      portalUrl: w.portalUrl,
      businessName: w.businessName,
      note: w.note,
      apiKeyHint: w.apiKeyHint ?? '',
      workspaceConfigured,
      envConfigured: this.portal.envConfigured(channel),
      active: !!live,
      source: live?.source ?? 'none',
    };
  }
}
