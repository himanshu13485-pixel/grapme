/**
 * LinkedInProvider — the single seam between product code and the automation engine.
 * v1 impl: UnipileProvider. A SelfHostedProvider (Playwright) can implement the same
 * interface later with no product-code changes.
 */

export interface HostedAuthLink {
  url: string;
  requestId: string;
}

export interface ProviderAccount {
  accountId: string;
  status: 'CONNECTED' | 'CREDENTIALS' | 'DISCONNECTED' | 'ERROR' | 'PENDING';
  fullName?: string;
  headline?: string;
  profileUrl?: string;
  avatarUrl?: string;
  connectionsCount?: number;
}

export interface ProviderMember {
  memberId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  location?: string;
  profileUrl?: string;
  avatarUrl?: string;
}

export interface ProviderMessage {
  messageId: string;
  chatId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  timestamp: string;
}

export const LINKEDIN_PROVIDER = Symbol('LINKEDIN_PROVIDER');

export interface LinkedInProvider {
  createHostedAuthLink(params: { name: string; successRedirect?: string }): Promise<HostedAuthLink>;
  getAccount(accountId: string): Promise<ProviderAccount>;
  resolveMember(accountId: string, profileUrl: string): Promise<ProviderMember>;
  sendConnection(params: { accountId: string; memberId: string; note?: string }): Promise<{ invitationId: string }>;
  sendMessage(params: { accountId: string; memberId: string; text: string }): Promise<{ chatId: string; messageId: string }>;
  isConnectionAccepted(params: { accountId: string; memberId: string }): Promise<boolean>;
  listMessages(params: { accountId: string; chatId: string }): Promise<ProviderMessage[]>;
}
