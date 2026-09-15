// Subscription history types + helpers (/api/v1/clients/:id/subscription-history).

export type SubStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED';

export interface PlanEntitlements {
  emailCredits?: number;
  linkedInCredits?: number;
  mailboxLimit?: number;
  seatLimit?: number;
  emailCampaignLimit?: number;
  linkedInCampaignLimit?: number;
}

export interface SubPeriod {
  id: string;
  plan: string;
  validityDays: number;
  startAt: string;
  endAt: string;
  amount?: number | null;
  currency?: string | null;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  /** Staff user who entered it (renewals). */
  recordedByName?: string | null;
  createdAt?: string;
  source: string;
  endedReason?: string | null;
  entitlements?: PlanEntitlements | null;
  current: boolean;
  status: SubStatus;
  daysLeft: number;
}

/** Compact chips of what a plan includes (skips undefined fields). */
export function entitlementChips(e?: PlanEntitlements | null): { icon: string; label: string; value: number }[] {
  if (!e) return [];
  const rows: { icon: string; label: string; value: number | undefined }[] = [
    { icon: '✉', label: 'Email credits', value: e.emailCredits },
    { icon: '📥', label: 'Mailboxes', value: e.mailboxLimit },
    { icon: '✈', label: 'Email campaigns', value: e.emailCampaignLimit },
    { icon: '🔗', label: 'LinkedIn credits', value: e.linkedInCredits },
    { icon: '🪑', label: 'Seats', value: e.seatLimit },
    { icon: '🧲', label: 'LinkedIn campaigns', value: e.linkedInCampaignLimit },
  ];
  return rows.filter((r) => r.value != null) as { icon: string; label: string; value: number }[];
}

export interface SubHistory {
  clientId: string;
  items: SubPeriod[];
}

export function subStatusMeta(s: SubStatus): { label: string; cls: string } {
  switch (s) {
    case 'ACTIVE': return { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' };
    case 'EXPIRING': return { label: 'Expiring soon', cls: 'bg-amber-50 text-amber-700' };
    case 'EXPIRED': return { label: 'Expired', cls: 'bg-rose-50 text-rose-700' };
    case 'SUPERSEDED': return { label: 'Replaced', cls: 'bg-slate-100 text-slate-500' };
    case 'CANCELLED': return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' };
    default: return { label: s, cls: 'bg-slate-100 text-slate-600' };
  }
}

/** Live status of a client from its validity window (for the global list, which uses
 *  /clients data). Mirrors the backend: none / expired / expiring / active. */
export type ClientSubState = 'none' | 'active' | 'expiring' | 'expired';
export function clientSubState(days?: number | null, startAt?: string | null): ClientSubState {
  if (!days || days <= 0) return 'none';
  if (!startAt) return 'active'; // window set but clock not started
  const remaining = Math.ceil((new Date(startAt).getTime() + days * 86_400_000 - Date.now()) / 86_400_000);
  if (remaining <= 0) return 'expired';
  return remaining <= 7 ? 'expiring' : 'active';
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtMoney(amount?: number | null, currency?: string | null): string {
  if (amount == null) return '—';
  return `${currency ? currency + ' ' : ''}${amount.toLocaleString()}`;
}
