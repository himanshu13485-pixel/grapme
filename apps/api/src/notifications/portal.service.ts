import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCredential } from '../common/crypto/credential-crypto';
import { MessagingChannel, channelMeta } from './channels';

export interface PortalSendResult {
  ok: boolean;
  messageId?: string | null;
  error?: string;
}

/** Resolved portal credentials for one workspace on one channel. */
export interface PortalConfig {
  channel: MessagingChannel;
  baseUrl: string;
  apiKey: string;
  /** Brand name used in the OTP message. */
  brand: string;
  /** Where the credentials came from — shown to admins so they can tell which is live. */
  source: 'workspace' | 'env';
}

/** What the portal reports about a project's session. */
export interface PortalStatus {
  ok: boolean;
  project?: string;
  channel?: string;
  bridge?: Record<string, unknown>;
  error?: string;
}

/**
 * Sends messages through our self-hosted portal, which holds one account per
 * project — a WhatsApp number on one, a Telegram account on another — and
 * talks to the right bridge on its own server.
 *
 * The portal's API is identical for both networks: the project's own channel
 * decides where a message goes, so nothing here says "WhatsApp" or "Telegram"
 * beyond picking which credentials to present.
 *
 * Credentials are per workspace per channel: an admin sets a portal URL + API
 * key under that channel's notification settings, stored encrypted on the
 * tenant. The env vars remain a fallback for installs configured purely
 * through the environment.
 *
 * Every call is best-effort: an outage returns a failed result rather than
 * throwing, so a user's action is never broken by messaging being down.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Credentials for a workspace on one channel: its own if set, else the env
   * fallback, else null (that channel is simply off for that workspace).
   */
  async configFor(tenantId: string | null | undefined, channel: MessagingChannel): Promise<PortalConfig | null> {
    return (tenantId ? await this.workspaceConfig(tenantId, channel) : null) ?? this.envConfig(channel);
  }

  /** True when a workspace can send on this channel — used to show "not configured". */
  async isConfigured(tenantId: string | null | undefined, channel: MessagingChannel): Promise<boolean> {
    return !!(await this.configFor(tenantId, channel));
  }

  /** Every channel this workspace can currently send on. */
  async activeChannels(tenantId: string | null | undefined): Promise<MessagingChannel[]> {
    const checks = await Promise.all(
      (['whatsapp', 'telegram'] as MessagingChannel[]).map(async (c) =>
        ((await this.configFor(tenantId, c)) ? c : null),
      ),
    );

    return checks.filter((c): c is MessagingChannel => !!c);
  }

  /**
   * Send a message on behalf of a workspace.
   *
   * `async` queues it at the portal and returns immediately — use that for
   * notifications, where waiting behind the paced send queue would stall the
   * request that triggered it. OTP stays synchronous so we know it actually went.
   */
  async send(
    tenantId: string | null | undefined,
    channel: MessagingChannel,
    to: string,
    text: string,
    opts: { async?: boolean } = {},
  ): Promise<PortalSendResult> {
    const cfg = await this.configFor(tenantId, channel);
    if (!cfg) {
      return { ok: false, error: `${channelMeta(channel).label} is not set up for this workspace.` };
    }

    const isAsync = !!opts.async;

    try {
      const res = await fetch(`${cfg.baseUrl}/api/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': cfg.apiKey,
        },
        body: JSON.stringify({ to, text, ...(isAsync ? { async: true } : {}) }),
        signal: AbortSignal.timeout(isAsync ? 8000 : 20000),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, any>;

      if (!res.ok || !body?.ok) {
        const error = body?.error ?? `Portal responded ${res.status}.`;
        this.logger.warn(`${channel} send failed: ${error}`);
        return { ok: false, error };
      }

      return { ok: true, messageId: body.messageId ?? null };
    } catch (err) {
      this.logger.warn(`${channel} send error: ${err}`);
      return { ok: false, error: `Could not reach the ${channelMeta(channel).label} service.` };
    }
  }

  /**
   * Ask the portal whether these credentials work and whether the account is
   * actually linked. Powers the "Test connection" button, so the answer has to
   * be specific enough to act on.
   */
  async status(tenantId: string | null | undefined, channel: MessagingChannel): Promise<PortalStatus> {
    const cfg = await this.configFor(tenantId, channel);
    if (!cfg) {
      return { ok: false, error: 'Add the portal URL and API key first.' };
    }

    try {
      const res = await fetch(`${cfg.baseUrl}/api/v1/status`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'x-api-key': cfg.apiKey },
        signal: AbortSignal.timeout(10000),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, any>;

      if (res.status === 401) {
        return { ok: false, error: 'The portal rejected this API key.' };
      }
      if (!res.ok || !body?.ok) {
        return { ok: false, error: body?.error ?? `Portal responded ${res.status}.` };
      }

      // The portal reports which network the project actually sends on. A key
      // pasted into the wrong card is otherwise invisible until a message goes
      // out on a network the user never chose.
      if (body.channel && body.channel !== channel) {
        return {
          ok: false,
          error: `That API key belongs to a ${body.channel} project. Use a ${channelMeta(channel).label} one here.`,
        };
      }

      return {
        ok: true,
        project: body.project ?? undefined,
        channel: body.channel ?? undefined,
        bridge: body.bridge ?? undefined,
      };
    } catch {
      return { ok: false, error: 'Could not reach the portal at that URL.' };
    }
  }

  /** Whether the env fallback is present, so the UI can say where sending comes from. */
  envConfigured(channel: MessagingChannel): boolean {
    return !!this.envConfig(channel);
  }

  // -- resolution ---------------------------------------------------------

  private async workspaceConfig(tenantId: string, channel: MessagingChannel): Promise<PortalConfig | null> {
    const meta = channelMeta(channel);

    let settings: Record<string, any> | null = null;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      settings = (tenant?.settings as Record<string, any>) ?? null;
    } catch (err) {
      this.logger.warn(`could not read ${channel} settings for tenant ${tenantId}: ${err}`);
      return null;
    }

    const w = (settings?.[meta.settingsKey] ?? {}) as Record<string, any>;
    // An admin switching a channel off must stop sending, not silently fall
    // back to the env credentials.
    if (w.enabled === false) return null;

    const baseUrl = String(w.portalUrl ?? '').trim().replace(/\/+$/, '');
    const encrypted = String(w.apiKeyEnc ?? '');
    if (!baseUrl || !encrypted) return null;

    let apiKey: string;
    try {
      apiKey = decryptCredential(encrypted);
    } catch (err) {
      // A key encrypted under a different CREDENTIAL_ENCRYPTION_KEY, or corrupted.
      this.logger.warn(`${channel} API key for tenant ${tenantId} could not be decrypted: ${err}`);
      return null;
    }

    return {
      channel,
      baseUrl,
      apiKey,
      brand: String(w.businessName ?? '').trim() || this.envBrand(),
      source: 'workspace',
    };
  }

  private envConfig(channel: MessagingChannel): PortalConfig | null {
    const meta = channelMeta(channel);
    const baseUrl = (this.config.get<string>(meta.envUrl) ?? '').trim().replace(/\/+$/, '');
    const apiKey = (this.config.get<string>(meta.envApiKey) ?? '').trim();
    if (!baseUrl || !apiKey) return null;

    return { channel, baseUrl, apiKey, brand: this.envBrand(), source: 'env' };
  }

  private envBrand(): string {
    return (this.config.get<string>('APP_NAME') ?? '').trim() || 'Grapme';
  }
}
