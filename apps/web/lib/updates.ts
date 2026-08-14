// Types + helpers for the Work / Meetings / Notification board (/api/v1/updates/*).

export type UpdateType = 'WORK' | 'MEETING' | 'NOTIFICATION';

/** A read receipt: someone (of those it was shared with) who has seen a message. */
export interface SeenReceipt {
  userId: string;
  name: string;
  role: string;
  at: string;
}

export interface UpdateReply {
  id: string;
  body: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  seenBy?: SeenReceipt[];
}

export interface UpdateThread {
  id: string;
  clientId: string;
  type: UpdateType;
  title: string;
  bodyHtml: string;
  authorName: string;
  authorRole: string;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  lastActivityAt: string;
  createdAt: string;
  replies?: UpdateReply[];
  clientName?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  seenBy?: SeenReceipt[];
  _count?: { replies: number };
}

export interface UpdatesPage {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  items: UpdateThread[];
  clientNames: Record<string, string>;
}

export interface BellItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read: boolean;
  createdAt: string;
}
export interface BellFeed { unread: number; items: BellItem[] }

// The Work board is now Work-only. Meeting & Notification were retired — Meetings
// live inside the Work conversation, and one-way Notifications moved to the
// dedicated admin Broadcast → client Notification feature. `updateTypeMeta` still
// renders the old labels for any legacy rows.
export const UPDATE_TYPES: { key: UpdateType; label: string; icon: string }[] = [
  { key: 'WORK', label: 'Work', icon: '🗂' },
];

export function updateTypeMeta(t: string): { label: string; icon: string; cls: string } {
  switch (t) {
    case 'WORK': return { label: 'Work', icon: '🗂', cls: 'bg-brand-50 text-brand-700' };
    case 'MEETING': return { label: 'Meeting', icon: '📅', cls: 'bg-violet-50 text-violet-700' };
    case 'NOTIFICATION': return { label: 'Notification', icon: '🔔', cls: 'bg-amber-50 text-amber-700' };
    default: return { label: t, icon: '•', cls: 'bg-slate-100 text-slate-600' };
  }
}

export function authorRoleLabel(role: string): string {
  switch (role) {
    case 'CLIENT': return 'Client';
    case 'SUPER_ADMIN': return 'Admin';
    case 'SUB_ADMIN': return 'Sub-Admin';
    case 'USER': return 'Team';
    default: return role;
  }
}

/** "3m ago" style relative time. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Full local date-time (stored timestamps shown on hover / in threads). */
export function dateTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
