import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsappSendResult {
  ok: boolean;
  messageId?: string | null;
  queued?: boolean;
  error?: string;
}

/**
 * Sends WhatsApp messages through our self-hosted WhatsApp portal, which holds
 * one WhatsApp number per project and talks to the bridge on its own server.
 *
 * Every call is best-effort: a portal outage returns a failed result rather than
 * throwing, so a user's action is never broken by WhatsApp being down.
 */
@Injectable()
export class WhatsappPortalService {
  private readonly logger = new Logger(WhatsappPortalService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return (this.config.get<string>('WA_PORTAL_URL') ?? '').replace(/\/+$/, '');
  }

  private apiKey(): string {
    return this.config.get<string>('WA_PORTAL_API_KEY') ?? '';
  }

  /** True once the portal URL + API key are set. */
  get configured(): boolean {
    return !!this.baseUrl() && !!this.apiKey();
  }

  /**
   * Send a message.
   *
   * `async` queues it at the portal and returns immediately — use that for
   * notifications, where waiting behind the paced send queue would stall the
   * request that triggered it. OTP stays synchronous so we know it actually went.
   */
  async send(to: string, text: string, opts: { async?: boolean } = {}): Promise<WhatsappSendResult> {
    if (!this.configured) {
      return { ok: false, error: 'WhatsApp portal is not configured (WA_PORTAL_URL / WA_PORTAL_API_KEY).' };
    }

    const isAsync = !!opts.async;

    try {
      const res = await fetch(`${this.baseUrl()}/api/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': this.apiKey(),
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

      return { ok: true, messageId: body.messageId ?? null, queued: !!body.queued };
    } catch (err) {
      this.logger.warn(`whatsapp send error: ${err}`);
      return { ok: false, error: 'Could not reach the WhatsApp service.' };
    }
  }
}
