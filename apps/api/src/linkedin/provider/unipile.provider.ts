import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LinkedInProvider,
  HostedAuthLink,
  ProviderAccount,
  ProviderMember,
  ProviderMessage,
  ProviderSearchResult,
} from './linkedin-provider.interface';

/**
 * Unipile implementation of LinkedInProvider. Uses the Unipile REST API (DSN + key).
 * The SDK is loaded lazily so the app boots before Unipile is configured.
 */
@Injectable()
export class UnipileProvider implements LinkedInProvider {
  private readonly logger = new Logger(UnipileProvider.name);
  private client: any;

  constructor(private readonly config: ConfigService) {}

  /** Full base URL, tolerant of a DSN that already includes the scheme. */
  private baseUrl(): string {
    const dsn = (this.config.get<string>('UNIPILE_DSN') ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return `https://${dsn}`;
  }

  private getClient() {
    if (this.client) return this.client;
    const dsn = this.config.get<string>('UNIPILE_DSN');
    const apiKey = this.config.get<string>('UNIPILE_API_KEY');
    if (!dsn || !apiKey) throw new Error('Unipile not configured (UNIPILE_DSN / UNIPILE_API_KEY)');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UnipileClient } = require('unipile-node-sdk');
    this.client = new UnipileClient(this.baseUrl(), apiKey);
    return this.client;
  }

  async createHostedAuthLink(params: { name: string; successRedirect?: string }): Promise<HostedAuthLink> {
    const client = this.getClient();
    const res = await client.account.createHostedAuthLink({
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: this.baseUrl(),
      expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      name: params.name,
      success_redirect_url: params.successRedirect,
      // Per-link callback so Unipile tells us when THIS account finishes connecting
      // (flips PENDING → CONNECTED). Requires a public base URL.
      ...(this.accountNotifyUrl() ? { notify_url: this.accountNotifyUrl() } : {}),
    });
    return { url: res.url, requestId: params.name };
  }

  /** Public webhook URL Unipile calls when a hosted-auth account connects. */
  private accountNotifyUrl(): string | undefined {
    const publicUrl = this.config.get<string>('APP_PUBLIC_URL');
    if (!publicUrl) return undefined;
    const secret = this.config.get<string>('UNIPILE_WEBHOOK_SECRET');
    const base = publicUrl.replace(/\/$/, '');
    return `${base}/api/v1/linkedin/webhooks/unipile/accounts${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
  }

  async getAccount(accountId: string): Promise<ProviderAccount> {
    const client = this.getClient();
    let a: Awaited<ReturnType<typeof client.account.getOne>>;
    try {
      a = await client.account.getOne(accountId);
    } catch (err) {
      // Account was deleted on Unipile's side → report it as disconnected so a
      // Sync reconciles the stale local row instead of erroring.
      if (isNotFound(err)) return { accountId, status: 'DISCONNECTED', deleted: true };
      throw err;
    }
    return {
      accountId,
      status: this.mapStatus(a?.sources?.[0]?.status),
      fullName: a?.name,
    };
  }

  async resolveMember(accountId: string, profileUrl: string): Promise<ProviderMember> {
    const client = this.getClient();
    const identifier = this.publicIdentifier(profileUrl);
    const p = await client.users.getProfile({ account_id: accountId, identifier });
    return {
      memberId: p?.provider_id ?? identifier,
      fullName: [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name,
      firstName: p?.first_name,
      lastName: p?.last_name,
      title: p?.headline,
      // Company lives on the current work experience, not at the top level.
      company: p?.work_experience?.[0]?.company ?? p?.company,
      location: p?.location,
      profileUrl,
      avatarUrl: p?.profile_picture_url,
    };
  }

  async sendConnection(params: { accountId: string; memberId: string; note?: string }): Promise<{ invitationId: string }> {
    const client = this.getClient();
    const res = await client.users.sendInvitation({
      account_id: params.accountId,
      provider_id: params.memberId,
      message: params.note,
    });
    return { invitationId: res?.invitation_id ?? res?.id ?? '' };
  }

  async withdrawConnection(params: { accountId: string; invitationId: string }): Promise<void> {
    if (!params.invitationId) return;
    const key = (this.config.get<string>('UNIPILE_API_KEY') ?? '').trim();
    const qs = new URLSearchParams({ account_id: params.accountId });
    const res = await fetch(`${this.baseUrl()}/api/v1/users/invite/sent/${encodeURIComponent(params.invitationId)}?${qs}`, {
      method: 'DELETE',
      headers: { 'X-API-KEY': key, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Unipile withdraw failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
    this.logger.log(`Withdrew invitation ${params.invitationId}`);
  }

  async sendMessage(params: { accountId: string; memberId: string; text: string }): Promise<{ chatId: string; messageId: string }> {
    const client = this.getClient();
    const res = await client.messaging.startNewChat({
      account_id: params.accountId,
      attendees_ids: [params.memberId],
      text: params.text,
    });
    return { chatId: res?.chat_id ?? '', messageId: res?.message_id ?? '' };
  }

  async isConnectionAccepted(params: { accountId: string; memberId: string }): Promise<boolean> {
    const client = this.getClient();
    const p = await client.users.getProfile({ account_id: params.accountId, identifier: params.memberId });
    // Unipile spells the 1st-degree signal a few different ways across API versions —
    // accept any of them so a field rename can't silently strand every lead as "Sent".
    const dist = String(p?.network_distance ?? '').toUpperCase();
    const accepted =
      ['FIRST_DEGREE', 'DISTANCE_1', 'FIRST', '1'].includes(dist) ||
      p?.is_relationship === true ||
      p?.is_connection === true ||
      p?.connection_degree === 1 ||
      p?.degree === 1;
    this.logger.log(`isConnectionAccepted member=${params.memberId} distance=${dist || '∅'} → ${accepted}`);
    return accepted;
  }

  async listMessages(params: { accountId: string; chatId: string }): Promise<ProviderMessage[]> {
    const client = this.getClient();
    const res = await client.messaging.getAllMessagesFromChat({ chat_id: params.chatId });
    const items = res?.items ?? res ?? [];
    return items.map((m: any) => ({
      messageId: m.id ?? m.message_id ?? '',
      chatId: params.chatId,
      direction: (m.is_sender ?? m.is_self) ? 'OUTBOUND' : 'INBOUND',
      text: m.text ?? m.message ?? '',
      timestamp: m.timestamp ?? m.created_at ?? new Date().toISOString(),
    }));
  }

  /** Collect the other participant(s)' provider ids from a Unipile chat object. */
  private chatMemberIds(c: any): string[] {
    const ids = new Set<string>();
    const add = (v: any) => { if (v) ids.add(String(v)); };
    add(c?.attendee_provider_id);
    for (const a of (c?.attendees ?? c?.attendee_ids ?? [])) {
      if (typeof a === 'string') add(a);
      else add(a?.provider_id ?? a?.id);
    }
    for (const id of (c?.attendee_provider_ids ?? [])) add(id);
    return [...ids];
  }

  async listChats(params: { accountId: string }): Promise<{ chatId: string; memberIds: string[] }[]> {
    const client = this.getClient();
    const res = await client.messaging.getAllChats({ account_id: params.accountId });
    const items = res?.items ?? res ?? [];
    return items
      .map((c: any) => ({ chatId: c.id ?? c.chat_id ?? '', memberIds: this.chatMemberIds(c) }))
      .filter((c: { chatId: string }) => c.chatId);
  }

  async getChatMemberIds(params: { accountId: string; chatId: string }): Promise<string[]> {
    const client = this.getClient();
    try {
      const c = await client.messaging.getChat({ chat_id: params.chatId });
      return this.chatMemberIds(c?.data ?? c ?? {});
    } catch {
      return [];
    }
  }

  // Maps Unipile LinkedIn source status → our account status.
  // Real values: OK | STOPPED | ERROR | CREDENTIALS | PERMISSIONS | CONNECTING.
  /** LinkedIn people search (classic). Not in the SDK — raw REST. */
  async searchPeople(params: { accountId: string; keywords: string; cursor?: string }): Promise<ProviderSearchResult> {
    const key = (this.config.get<string>('UNIPILE_API_KEY') ?? '').trim();
    const qs = new URLSearchParams({ account_id: params.accountId });
    if (params.cursor) qs.set('cursor', params.cursor);
    const res = await fetch(`${this.baseUrl()}/api/v1/linkedin/search?${qs}`, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ api: 'classic', category: 'people', keywords: params.keywords }),
    });
    if (!res.ok) throw new Error(`Unipile search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const items: any[] = data?.items ?? data?.results ?? [];
    const people = items
      .filter((p) => p?.public_profile_url || p?.profile_url)
      .map((p) => ({
        fullName: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || undefined),
        firstName: p.first_name,
        lastName: p.last_name,
        title: p.headline ?? undefined,
        // Classic people-search returns no company field — best-effort parse from
        // the headline ("… at Acme", "… @ Acme"). Enriched precisely at contact time.
        company: p.current_positions?.[0]?.company ?? p.work_experience?.[0]?.company ?? this.companyFromHeadline(p.headline) ?? undefined,
        location: p.location ?? undefined,
        profileUrl: String(p.public_profile_url ?? p.profile_url).split('?')[0],
      }));
    return { people, cursor: data?.cursor };
  }

  /** The account's own 1st-degree connections (one page). Raw REST — /users/relations. */
  async listRelations(params: { accountId: string; cursor?: string }): Promise<{ people: ProviderMember[]; cursor?: string }> {
    const key = (this.config.get<string>('UNIPILE_API_KEY') ?? '').trim();
    const qs = new URLSearchParams({ account_id: params.accountId, limit: '100' });
    if (params.cursor) qs.set('cursor', params.cursor);
    const res = await fetch(`${this.baseUrl()}/api/v1/users/relations?${qs}`, {
      method: 'GET',
      headers: { 'X-API-KEY': key, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Unipile relations failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const items: any[] = data?.items ?? data?.relations ?? data?.data ?? [];
    const people: ProviderMember[] = items.map((p) => {
      const ident = p.public_identifier ?? p.public_id;
      return {
        memberId: String(p.member_id ?? p.provider_id ?? p.id ?? ident ?? ''),
        fullName: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || undefined),
        firstName: p.first_name,
        lastName: p.last_name,
        title: p.headline ?? undefined,
        company: p.current_positions?.[0]?.company ?? p.work_experience?.[0]?.company ?? this.companyFromHeadline(p.headline) ?? undefined,
        location: p.location ?? undefined,
        profileUrl: p.public_profile_url ?? p.profile_url ?? (ident ? `https://www.linkedin.com/in/${ident}` : undefined),
        avatarUrl: p.profile_picture_url ?? undefined,
      };
    }).filter((m) => m.memberId);
    return { people, cursor: data?.cursor };
  }

  /** Best-effort company from a LinkedIn headline: text after " at "/" @ " up to a separator. */
  private companyFromHeadline(headline?: string): string | undefined {
    if (!headline) return undefined;
    const m = headline.match(/\s(?:@\s*|at\s+)([^|·•]+)/i);
    const co = m?.[1]?.trim();
    return co && co.length >= 2 && co.length <= 60 ? co : undefined;
  }

  private mapStatus(s?: string): ProviderAccount['status'] {
    switch ((s ?? '').toUpperCase()) {
      case 'OK':
      case 'CONNECTED': return 'CONNECTED';
      case 'CREDENTIALS':
      case 'PERMISSIONS': return 'CREDENTIALS';
      case 'STOPPED': return 'DISCONNECTED';
      case 'ERROR': return 'ERROR';
      case 'CONNECTING': return 'PENDING';
      default: return 'PENDING';
    }
  }

  private publicIdentifier(profileUrl: string): string {
    const m = profileUrl.match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : profileUrl;
  }
}

/** True when a Unipile error means "this account no longer exists" (deleted/unlinked). */
function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; body?: { status?: number }; message?: string };
  const code = e?.status ?? e?.statusCode ?? e?.body?.status;
  if (code === 404) return true;
  return /\b404\b|not[\s_-]*found|no such account|unknown account|does not exist/i.test(String(e?.message ?? err));
}
