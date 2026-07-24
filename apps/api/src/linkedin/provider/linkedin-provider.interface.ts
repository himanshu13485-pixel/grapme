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
  /** True when the account no longer exists on the provider (deleted/unlinked). */
  deleted?: boolean;
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
  /** LinkedIn connection count, if the profile exposes it (undefined = hidden/unknown). */
  connectionsCount?: number;
}

export interface ProviderMessage {
  messageId: string;
  chatId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  timestamp: string;
}

export interface ProviderSearchPerson {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  location?: string;
  profileUrl: string;
}

export interface ProviderSearchResult {
  people: ProviderSearchPerson[];
  cursor?: string;
}

/** A messaging chat on an account, with the other participant(s)' member ids. */
export interface ProviderChat {
  chatId: string;
  memberIds: string[];
}

export const LINKEDIN_PROVIDER = Symbol('LINKEDIN_PROVIDER');

export interface LinkedInProvider {
  createHostedAuthLink(params: { name: string; successRedirect?: string }): Promise<HostedAuthLink>;
  getAccount(accountId: string): Promise<ProviderAccount>;
  resolveMember(accountId: string, profileUrl: string): Promise<ProviderMember>;
  sendConnection(params: { accountId: string; memberId: string; note?: string }): Promise<{ invitationId: string }>;
  /** Withdraw a previously-sent connection invite (best-effort). */
  withdrawConnection(params: { accountId: string; invitationId: string }): Promise<void>;
  sendMessage(params: { accountId: string; memberId: string; text: string }): Promise<{ chatId: string; messageId: string }>;
  isConnectionAccepted(params: { accountId: string; memberId: string }): Promise<boolean>;
  listMessages(params: { accountId: string; chatId: string }): Promise<ProviderMessage[]>;
  /** The account's own 1st-degree connections (paginated), for bulk import. */
  listRelations(params: { accountId: string; cursor?: string }): Promise<{ people: ProviderMember[]; cursor?: string }>;
  /** Recent chats on the account, each with the other participant(s)' member ids. */
  listChats(params: { accountId: string }): Promise<ProviderChat[]>;
  /** The other participant(s)' member ids for a single chat (webhook auto-attach). */
  getChatMemberIds(params: { accountId: string; chatId: string }): Promise<string[]>;
  searchPeople(params: { accountId: string; keywords: string; cursor?: string }): Promise<ProviderSearchResult>;
}
