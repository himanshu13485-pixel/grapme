// Types for the LinkedIn channel (API under /api/v1/linkedin/*).

export interface LiSubscription {
  id: string;
  clientId: string;
  planName?: string | null;
  seats: number;
  creditsBalance: number;
  validityDays?: number | null;
  validityStartAt?: string | null;
  whatsappEnabled: boolean;
  whatsappNumber?: string | null;
  timezone: string;
}

export type LinkedInAccountStatus = 'PENDING' | 'CONNECTED' | 'CREDENTIALS' | 'DISCONNECTED' | 'ERROR';

export interface LinkedInAccount {
  id: string;
  status: LinkedInAccountStatus;
  fullName?: string | null;
  headline?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  connectionsCount?: number | null;
  lastSyncedAt?: string | null;
  createdAt: string;
}

/** Visual health for a connected LinkedIn account. `healthy` = able to send. */
export function accountHealth(status: LinkedInAccountStatus): { label: string; dot: string; text: string; healthy: boolean; attention: boolean } {
  switch (status) {
    case 'CONNECTED':    return { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-700', healthy: true, attention: false };
    case 'PENDING':      return { label: 'Pending auth', dot: 'bg-amber-400', text: 'text-amber-700', healthy: false, attention: false };
    case 'CREDENTIALS':  return { label: 'Needs re-auth', dot: 'bg-amber-500', text: 'text-amber-700', healthy: false, attention: true };
    case 'DISCONNECTED': return { label: 'Disconnected', dot: 'bg-rose-500', text: 'text-rose-700', healthy: false, attention: true };
    case 'ERROR':        return { label: 'Error', dot: 'bg-rose-600', text: 'text-rose-700', healthy: false, attention: true };
    default:             return { label: status, dot: 'bg-slate-400', text: 'text-slate-600', healthy: false, attention: false };
  }
}

/** "3m ago" style relative time. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

export interface LiCampaign {
  id: string;
  name: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED' | 'DELETED';
  mode: 'REGULAR' | 'AI';
  outreachType: 'WITH_CONNECTION' | 'DIRECT_MESSAGES';
  createdAt: string;
  linkedInAccount?: { fullName?: string | null; avatarUrl?: string | null };
  _count?: { leads: number };
}

export interface LiKnowledgeStats {
  profileCount: number;
  aiKnowledgePct: number;
}

export interface ClientRow {
  id: string;
  name: string;
  plan?: string;
  status: string;
}

export interface LiSequenceStep {
  id: string;
  order: number;
  type: 'CONNECTION_REQUEST' | 'MESSAGE';
  waitHours: number;
  body?: string | null;
  note?: string | null;
}

export interface LiCampaignDetail extends LiCampaign {
  timezone: string;
  outreachType: 'WITH_CONNECTION' | 'DIRECT_MESSAGES';
  steps: LiSequenceStep[];
  audienceSpec?: Record<string, string[]> | null;
  linkedInAccountId?: string | null;
  run247?: boolean;
  workStartHour?: number;
  workEndHour?: number;
  workDays?: number[];
  dailyConnectionLimit?: number;
  dailyMessageLimit?: number;
  warmupEnabled?: boolean;
  warmupStartLimit?: number;
  warmupDays?: number;
  dripEnabled?: boolean;
  dripDailyTarget?: number;
  dripBuffer?: number;
  linkedInAccount?: { id?: string; fullName?: string | null; avatarUrl?: string | null };
  businessProfile?: { id: string; name: string; completeness: number } | null;
  strategy?: { id: string; name: string; completeness: number } | null;
}

export interface LiCampaignStats {
  sent: number;
  accepted: number;
  replied: number;
  totalMessages: number;
  acceptanceRate: number;
  replyRate: number;
  sentiment: { positive: number; neutral: number; negative: number };
}

export interface LiLead {
  id: string;
  fullName: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  profileUrl?: string | null;
  status: string;
  currentStep: number;
  sentiment?: string | null;
}

export interface LiLeadsPage {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  items: LiLead[];
  tabCounts: Record<string, number>;
}

export interface LiInboxItem {
  conversationId: string;
  unreadCount: number;
  needsReply: boolean;
  lastReplyAt?: string | null;
  analyzed: boolean;
  lead: { id: string; fullName: string; title?: string | null; company?: string | null; location?: string | null; avatarUrl?: string | null; sentiment?: string | null; intent?: string | null };
  account?: { id?: string; fullName?: string | null } | null;
  campaign: { id: string; name: string };
}

export interface LiInboxCounts { all: number; unread: number; needsReply: number; replied: number }

export interface LiAiFetch { id: string; intent?: string | null; sentiment?: string | null; draftReply?: string | null }

export interface LiThreadMessage { id: string; direction: 'INBOUND' | 'OUTBOUND'; source: string; body: string; sentAt: string }

export interface LiThread {
  id: string;
  unreadCount: number;
  needsReply: boolean;
  messages: LiThreadMessage[];
  lead: { id: string; fullName: string; firstName?: string | null; title?: string | null; company?: string | null; aiFetches: LiAiFetch[] };
}

export interface LiKnowledgeSummary { id: string; name: string; slug?: string | null; completeness: number; updatedAt?: string }
export interface LiChatMessage { id: string; role: string; content: string }
export interface LiChatCurrent { key: string; label: string; type: 'choice' | 'text'; question: string; options: string[] }
export interface LiChatState { messages: LiChatMessage[]; completeness: number; current: LiChatCurrent | null; done: boolean }
export interface LiKnowledgeDetails {
  id: string; name: string; kind: string; completeness: number;
  sections: { section: string; fields: { key: string; label: string; value: string | null; collected: boolean }[] }[];
}
