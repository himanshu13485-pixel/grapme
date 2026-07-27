import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCredential } from '../common/crypto/credential-crypto';

export interface WhatsappSendResult {
  ok: boolean;
  messageId?: string | null;
  error?: string;
}

/** Resolved portal credentials for one workspace. */
export interface PortalConfig {
  baseUrl: string;
  apiKey: string;
  /** Brand name used in the OTP message. */
  brand: string;
  /** Where the credentials came from — shown to admins so they can tell which is live. */
  source: 'workspace' | 'env';
}

/** What the portal reports about a project's WhatsApp session. */
export interface PortalStatus {
  ok: boolean;
  project?: string;
  bridge?: Record<string, unknown>;
  error?: string;
}

/**
 * Sends WhatsApp messages through our self-hosted WhatsApp portal, which holds
 * one WhatsApp number per project and talks to the bridge on its own server.
 *
 * Credentials are per workspace: an admin sets the portal URL + API key under
 * WhatsApp notifications, and they're stored encrypted on the tenant. The
 * WA_PORTAL_* env vars remain a fallback for workspaces that haven't set their
 * own, so an install configured purely through env keeps working.
 *
 * Every call is best-effort: a portal outage returns a failed result rather than
 * throwing, so a user's action is never broken by WhatsApp being down.
 */
@Injectable()
export class WhatsappPortalService {
  private readonly logger = new Logger(WhatsappPortalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Portal credentials for a workspace: its own if set, else the env fallback,
   * else null (WhatsApp is simply off for that workspace).
   */
  async configFor(tenantId?: string | null): Promise<PortalConfig | null> {
    return (tenantId ? await this.workspaceConfig(tenantId) : null) ?? this.envConfig();
  }

  /** True when a workspace can send — used to show "not configured" in the UI. */
  async isConfigured(tenantId?: string | null): Promise<boolean> {
    return !!(await this.configFor(tenantId));
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
    to: string,
    text: string,
    opts: { async?: boolean } = {},
  ): Promise<WhatsappSendResult> {
    const cfg = await this.configFor(tenantId);
    if (!cfg) {
      return { ok: false, error: 'WhatsApp is not set up for this workspace.' };
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
        this.logger.warn(`whatsapp send failed: ${error}`);
        return { ok: false, error };
      }

      return { ok: true, messageId: body.messageId ?? null };
    } catch (err) {
      this.logger.warn(`whatsapp send error: ${err}`);
      return { ok: false, error: 'Could not reach the WhatsApp service.' };
    }
  }

  /**
   * Ask the portal whether these credentials work and whether the number is
   * actually paired. Powers the "Test connection" button, so the answer has to
   * be specific enough to act on.
   */
  async status(tenantId?: string | null): Promise<PortalStatus> {
    const cfg = await this.configFor(tenantId);
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

      return { ok: true, project: body.project ?? undefined, bridge: body.bridge ?? undefined };
    } catch {
      return { ok: false, error: 'Could not reach the portal at that URL.' };
    }
  }

  /** Whether the env fallback is present, so the UI can say where sending comes from. */
  get envConfigured(): boolean {
    return !!this.envConfig();
  }

  // -- resolution ---------------------------------------------------------

  private async workspaceConfig(tenantId: string): Promise<PortalConfig | null> {
    let settings: Record<string, any> | null = null;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      settings = (tenant?.settings as Record<string, any>) ?? null;
    } catch (err) {
      this.logger.warn(`could not read WhatsApp settings for tenant ${tenantId}: ${err}`);
      return null;
    }

    const w = (settings?.whatsapp ?? {}) as Record<string, any>;
    // An admin switching WhatsApp off must stop sending, not silently fall back
    // to the env credentials.
    if (w.enabled === false) return null;

    const baseUrl = String(w.portalUrl ?? '').trim().replace(/\/+$/, '');
    const encrypted = String(w.apiKeyEnc ?? '');
    if (!baseUrl || !encrypted) return null;

    let apiKey: string;
    try {
      apiKey = decryptCredential(encrypted);
    } catch (err) {
      // A key encrypted under a different CREDENTIAL_ENCRYPTION_KEY, or corrupted.
      this.logger.warn(`WhatsApp API key for tenant ${tenantId} could not be decrypted: ${err}`);
      return null;
    }

    return {
      baseUrl,
      apiKey,
      brand: String(w.businessName ?? '').trim() || this.envBrand(),
      source: 'workspace',
    };
  }

  private envConfig(): PortalConfig | null {
    const baseUrl = (this.config.get<string>('WA_PORTAL_URL') ?? '').trim().replace(/\/+$/, '');
    const apiKey = (this.config.get<string>('WA_PORTAL_API_KEY') ?? '').trim();
    if (!baseUrl || !apiKey) return null;

    return { baseUrl, apiKey, brand: this.envBrand(), source: 'env' };
  }

  private envBrand(): string {
    return (this.config.get<string>('APP_NAME') ?? '').trim() || 'Grapme';
  }
}
