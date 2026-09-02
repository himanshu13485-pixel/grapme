import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCredential } from '../common/crypto/credential-crypto';
import { MESSAGING_CHANNELS, MessagingChannel, channelMeta } from './channels';

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
 * Sends messages on whichever network a channel names.
 *
 * Two of them go through our self-hosted portal, which holds one account per
 * project — a WhatsApp number on one, a Telegram account on another — and
 * talks to the right bridge on its own server. Netvork is our own app and has
 * no portal: it is reached as an ordinary user of it, sending a direct message
 * from an account we hold a token for. Which of the two a channel uses is
 * `transport` in its ChannelMeta; everything above that line is identical.
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
      MESSAGING_CHANNELS.map(async (c) => ((await this.configFor(tenantId, c)) ? c : null)),
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

    // Netvork is not a portal — it is our own app, reached as a user of it.
    if (channelMeta(channel).transport === 'netvork') {
      return this.sendViaNetvork(cfg, to, text);
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

    if (channelMeta(channel).transport === 'netvork') {
      return this.netvorkStatus(cfg);
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

  // -- Netvork --------------------------------------------------------------

  /**
   * Direct conversations already opened, keyed by install + App ID.
   *
   * Netvork addresses a message by conversation, not by person, so reaching
   * someone is two calls: find the thread, then post to it. The thread is
   * permanent once made — Conversation::directBetween returns the same one
   * every time — so remembering it turns the steady state into one call.
   *
   * In-process and unbounded on purpose: an entry is two short strings, and
   * the population is "people this workspace sends alerts to". A restart
   * simply pays for the lookup once more.
   */
  private readonly netvorkThreads = new Map<string, string>();

  /**
   * Send as a direct message from the account whose token we hold.
   *
   * `async` has no meaning here and is ignored: Netvork returns as soon as the
   * message is stored and does its own fan-out to the bell and the recipient's
   * devices from a queue on its side.
   */
  private async sendViaNetvork(cfg: PortalConfig, to: string, text: string): Promise<PortalSendResult> {
    const appId = to.trim();
    if (!appId) return { ok: false, error: 'No Netvork App ID for this user.' };

    const key = `${cfg.baseUrl}|${appId.toLowerCase()}`;

    for (const attempt of [1, 2]) {
      const thread = this.netvorkThreads.get(key) ?? (await this.netvorkThread(cfg, appId));
      if (typeof thread !== 'string') return thread;

      try {
        const res = await fetch(`${cfg.baseUrl}/api/v1/conversations/${thread}/messages`, {
          method: 'POST',
          headers: this.netvorkHeaders(cfg),
          body: JSON.stringify({ body: text, type: 'text' }),
          signal: AbortSignal.timeout(15000),
        });

        // The thread we remembered is gone — forget it and look it up again,
        // once. Anything else is reported as it stands.
        if (res.status === 404 && attempt === 1) {
          this.netvorkThreads.delete(key);
          continue;
        }

        const body = (await res.json().catch(() => ({}))) as Record<string, any>;

        if (!res.ok) {
          const error = body?.message ?? `Netvork responded ${res.status}.`;
          this.logger.warn(`netvork send failed: ${error}`);
          return { ok: false, error };
        }

        this.netvorkThreads.set(key, thread);

        return { ok: true, messageId: body?.data?.uuid ?? null };
      } catch (err) {
        this.logger.warn(`netvork send error: ${err}`);
        return { ok: false, error: 'Could not reach Netvork.' };
      }
    }

    return { ok: false, error: 'Could not open a Netvork conversation.' };
  }

  /** The direct conversation with this App ID, opening it if there isn't one. */
  private async netvorkThread(cfg: PortalConfig, appId: string): Promise<string | PortalSendResult> {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: this.netvorkHeaders(cfg),
        body: JSON.stringify({ app_id: appId }),
        signal: AbortSignal.timeout(10000),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, any>;

      if (!res.ok) {
        /*
         * Netvork's own words, passed through rather than flattened.
         *
         * The two that matter both need the user to do something, and only
         * Netvork can say which: "no user found for that App ID", and the
         * privacy setting that means our sending account has to be one of
         * their connections first. A generic "send failed" here would leave
         * an admin with no idea which.
         */
        const error = body?.message ?? `Netvork responded ${res.status}.`;
        this.logger.warn(`netvork conversation failed: ${error}`);

        // Not connected yet. Ask, so the person has a request waiting rather
        // than a instruction to go and find us. Netvork answers 409 if one is
        // already pending, which is why this can run on every attempt without
        // pestering anybody.
        if (res.status === 403) {
          await this.netvorkConnect(cfg, appId);

          return {
            ok: false,
            error:
              'Netvork needs you to be connected first. A connection request has been sent — accept it in Netvork and try again.',
          };
        }

        return { ok: false, error };
      }

      const uuid = body?.data?.uuid;
      if (typeof uuid !== 'string' || !uuid) {
        return { ok: false, error: 'Netvork did not return a conversation.' };
      }

      return uuid;
    } catch (err) {
      this.logger.warn(`netvork conversation error: ${err}`);
      return { ok: false, error: 'Could not reach Netvork.' };
    }
  }

  /**
   * Ask to connect, so the person has something to accept.
   *
   * Netvork only delivers to the sending account's connections, and this is
   * the half of that handshake we can do ourselves. The other half is theirs
   * and stays theirs: a person decides whether an application may message
   * them, and can disconnect later. Best-effort — a failure here only means
   * they connect the long way round, so it must never break the send path
   * that called it.
   */
  private async netvorkConnect(cfg: PortalConfig, appId: string): Promise<void> {
    try {
      await fetch(`${cfg.baseUrl}/api/v1/connections`, {
        method: 'POST',
        headers: this.netvorkHeaders(cfg),
        body: JSON.stringify({
          app_id: appId,
          message: `${cfg.brand} would like to send you notifications here.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      this.logger.warn(`netvork connect request failed: ${err}`);
    }
  }

  /**
   * Whether the token works, answered by asking Netvork who we are. Names the
   * account, so an admin can see which identity their people will hear from.
   */
  private async netvorkStatus(cfg: PortalConfig): Promise<PortalStatus> {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/v1/me`, {
        headers: this.netvorkHeaders(cfg),
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 401) {
        return { ok: false, error: 'Netvork rejected this token. Sign in as the sending account and issue a new one.' };
      }

      const body = (await res.json().catch(() => ({}))) as Record<string, any>;

      if (!res.ok) {
        return { ok: false, error: body?.message ?? `Netvork responded ${res.status}.` };
      }

      const me = body?.data ?? body;
      // The name, because that is what people will see the messages come
      // from; the App ID beside it, because that is what they connect to.
      const name = me?.name ?? me?.username ?? 'this account';
      const appId = me?.app_id ? ` (${me.app_id})` : '';

      /*
       * `connected: true` is the literal truth and worth stating plainly.
       *
       * The two phone channels report a bridge holding a session that can drop
       * — the card asks after it, and rightly. Netvork has no session: a valid
       * token is the whole of being connected. Left unsaid, the card read the
       * missing bridge as a dead one and told an admin their working setup was
       * broken.
       */
      return {
        ok: true,
        project: `${name}${appId}`,
        channel: 'netvork',
        // No `me`: the card prints it beside the name it already showed.
        bridge: { connected: true, status: 'ready' },
      };
    } catch {
      return { ok: false, error: 'Could not reach Netvork at that URL.' };
    }
  }

  private netvorkHeaders(cfg: PortalConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    };
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
