import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LinkedInProvider,
  HostedAuthLink,
  ProviderAccount,
  ProviderMember,
  ProviderMessage,
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

  private getClient() {
    if (this.client) return this.client;
    const dsn = this.config.get<string>('UNIPILE_DSN');
    const apiKey = this.config.get<string>('UNIPILE_API_KEY');
    if (!dsn || !apiKey) throw new Error('Unipile not configured (UNIPILE_DSN / UNIPILE_API_KEY)');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UnipileClient } = require('unipile-node-sdk');
    this.client = new UnipileClient(`https://${dsn}`, apiKey);
    return this.client;
  }

  async createHostedAuthLink(params: { name: string; successRedirect?: string }): Promise<HostedAuthLink> {
    const client = this.getClient();
    const res = await client.account.createHostedAuthLink({
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: `https://${this.config.get('UNIPILE_DSN')}`,
      expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      name: params.name,
      success_redirect_url: params.successRedirect,
    });
    return { url: res.url, requestId: params.name };
  }

  async getAccount(accountId: string): Promise<ProviderAccount> {
    const client = this.getClient();
    const a = await client.account.getOne(accountId);
    return {
      accountId,
      status: this.mapStatus(a?.sources?.[0]?.status ?? a?.status),
      fullName: a?.name,
      connectionsCount: a?.connections_count,
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
      company: p?.company,
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
    return p?.network_distance === 'DISTANCE_1' || p?.is_relationship === true;
  }

  async listMessages(params: { accountId: string; chatId: string }): Promise<ProviderMessage[]> {
    const client = this.getClient();
    const res = await client.messaging.getAllMessagesFromChat({ account_id: params.accountId, chat_id: params.chatId });
    const items = res?.items ?? res ?? [];
    return items.map((m: any) => ({
      messageId: m.id,
      chatId: params.chatId,
      direction: m.is_sender ? 'OUTBOUND' : 'INBOUND',
      text: m.text ?? '',
      timestamp: m.timestamp ?? m.created_at,
    }));
  }

  private mapStatus(s?: string): ProviderAccount['status'] {
    switch ((s ?? '').toUpperCase()) {
      case 'OK':
      case 'CONNECTED': return 'CONNECTED';
      case 'CREDENTIALS':
      case 'CHECKPOINT': return 'CREDENTIALS';
      case 'DISCONNECTED': return 'DISCONNECTED';
      case 'ERROR': return 'ERROR';
      default: return 'PENDING';
    }
  }

  private publicIdentifier(profileUrl: string): string {
    const m = profileUrl.match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : profileUrl;
  }
}
