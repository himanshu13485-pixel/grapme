'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
import { PageHeader, EmptyState, StatusBadge, Tabs } from '@/components/ui';
import { LiSubscription, LiCampaign, LiKnowledgeStats, timeAgo, purgeCountdown } from '@/lib/linkedin';
import { LinkedInAccounts, useLinkedInAccounts } from '@/components/LinkedInAccounts';
import { LiInbox } from '@/components/LiInbox';
import { ValidityBadge } from '@/components/Validity';

interface ClientHead { name: string; emailEnabled?: boolean; linkedInEnabled?: boolean; status?: string; validityDays?: number | null; validityStartAt?: string | null }

export default function ClientLinkedInPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [client, setClient] = useState<ClientHead | null>(null);
  const [emailOn, setEmailOn] = useState(true);
  const [linkedInOn, setLinkedInOn] = useState<boolean | null>(null);
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(['accounts', 'campaigns', 'inbox'].includes(requestedTab ?? '') ? requestedTab! : 'campaigns');
  const clientName = client?.name ?? '';
  const isActive = (client?.status ?? 'active').toLowerCase() === 'active';

  useEffect(() => {
    api.get<ClientHead>(`/clients/${clientId}`)
      .then((c) => { setClient(c); setEmailOn(c.emailEnabled !== false); setLinkedInOn(!!c.linkedInEnabled); })
      .catch(() => setLinkedInOn(false));
  }, [clientId]);

  return (
    <div>
      <Link href="/linkedin" className="text-sm text-slate-500 hover:text-slate-800">← LinkedIn Outreach</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={`${clientName || 'Client'} · LinkedIn`} subtitle="Subscription, connected accounts, and campaigns for this client." />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
            <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />{isActive ? 'Active' : 'Inactive'}
          </span>
          {client && <ValidityBadge days={client.validityDays} startAt={client.validityStartAt} />}
          <Link href={`/clients/${clientId}`} className="btn-ghost whitespace-nowrap">ℹ Profile details</Link>
        </div>
      </div>

      {/* Channel switcher — jump back to this client's Email workspace. */}
      <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => router.push(`/clients/${clientId}?channel=email`)}
          className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700"
        >
          📧 Email
          {!emailOn && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">Not subscribed</span>}
        </button>
        <button type="button" className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm">
          🔗 LinkedIn
        </button>
      </div>

      {linkedInOn === null ? (
        <EmptyState message="Loading…" />
      ) : linkedInOn === false ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="text-4xl opacity-70">🔗</div>
          <div className="text-lg font-semibold text-slate-700">LinkedIn channel — not subscribed</div>
          <p className="max-w-md text-sm text-slate-500">
            This client isn&apos;t subscribed to the LinkedIn outreach channel. Edit the client and set its Outreach channels to enable it.
          </p>
        </div>
      ) : (
        <>
          {/* Persistent plan stats — shown above every tab (plan settings are edited in New/Edit Client). */}
          <StatsHeader clientId={clientId} />

          <Tabs
            tabs={[
              { key: 'accounts', label: 'Accounts' },
              { key: 'campaigns', label: 'Campaigns' },
              { key: 'inbox', label: 'Inbox' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'accounts' && <AccountsTab clientId={clientId} />}
          {tab === 'campaigns' && <CampaignsTab clientId={clientId} />}
          {tab === 'inbox' && <LiInbox clientId={clientId} />}
        </>
      )}
    </div>
  );
}

// ── Plan stats header (read-only; plan settings live in New/Edit Client) ──
function StatsHeader({ clientId }: { clientId: string }) {
  const [sub, setSub] = useState<LiSubscription | null>(null);
  const [stats, setStats] = useState<LiKnowledgeStats | null>(null);
  const [client, setClient] = useState<{ validityDays?: number | null; validityStartAt?: string | null } | null>(null);

  const load = useCallback(async () => {
    const [s, st, cl] = await Promise.all([
      api.get<LiSubscription>(`/linkedin/clients/${clientId}/subscription`),
      api.get<LiKnowledgeStats>(`/linkedin/clients/${clientId}/knowledge-stats`),
      api.get<{ validityDays?: number | null; validityStartAt?: string | null }>(`/clients/${clientId}`).catch(() => null),
    ]);
    setSub(s); setStats(st); setClient(cl);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
      <Stat label="Seats" value={sub?.seats ?? '—'} />
      {/* Credits are managed from Subscription Management, not adjusted inline. */}
      <Stat label="Credits" value={sub?.creditsBalance ?? '—'} />
      <Stat label="Plan validity (days)" value={client?.validityDays ?? '—'} sub={validityLeft(client?.validityDays, client?.validityStartAt)} />
      <Stat label="AI Knowledge" value={`${stats?.aiKnowledgePct ?? 0}%`} sub={`${stats?.profileCount ?? 0} profiles`} />
    </div>
  );
}

// ── Accounts (connect via Unipile) ───────────────────────────────────────
// Shared with the client portal: same connect/remove/sync/poll + row UI. The admin
// surface adds a shareable hosted-auth link (mode="modal"), per-row Sync/Reconnect,
// and can remove CONNECTED seats.
function AccountsTab({ clientId }: { clientId: string }) {
  const li = useLinkedInAccounts({ base: '/linkedin', clientId, mode: 'modal' });
  const [seats, setSeats] = useState<number | undefined>(undefined);
  useEffect(() => {
    api.get<LiSubscription>(`/linkedin/clients/${clientId}/subscription`)
      .then((s) => setSeats(s.seats))
      .catch(() => {});
  }, [clientId]);

  return (
    <LinkedInAccounts
      li={li}
      mode="modal"
      seats={seats}
      showSync
      showReconnect
      allowRemoveConnected
      showHealthSummary
    />
  );
}

// ── Campaigns ────────────────────────────────────────────────────────────
const CAMPAIGN_TABS: [string, string][] = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['archived', 'Archived'], ['deleted', 'Deleted']];

function CampaignsTab({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<LiCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('ongoing');
  const canDelete = useCanDelete();

  const load = useCallback(async () => {
    setLoaded(false);
    setCampaigns(await api.get<LiCampaign[]>(`/linkedin/campaigns?clientId=${clientId}&view=${view}`));
    setLoaded(true);
  }, [clientId, view]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, path: string) { await api.post(`/linkedin/campaigns/${id}/${path}`); load(); }
  async function del(id: string, name: string) {
    if (!confirm(`Delete LinkedIn campaign "${name}"?\n\nIt moves to the Deleted tab and stops sending. You can restore it, or permanently delete it there.`)) return;
    try { await act(id, 'delete'); } catch (e: any) { alert(e?.message ?? 'Failed to delete'); }
  }
  async function hardDel(id: string, name: string) {
    if (!confirm(`Permanently delete "${name}"?\n\nThis CANNOT be undone — its leads, messages and history are erased.`)) return;
    try { await act(id, 'hard-delete'); } catch (e: any) { alert(e?.message ?? 'Failed'); }
  }
  async function sendNext(id: string) {
    try {
      const r = await api.post<{ ok: boolean; message?: string }>(`/linkedin/campaigns/${id}/send-next`, {});
      alert(r.ok ? 'Next scheduled action queued to send now (subject to the daily cap).' : (r.message ?? 'Nothing pending to send.'));
    } catch (e: any) { alert(e?.message ?? 'Failed'); }
  }
  async function replicate(id: string, name: string) {
    if (!confirm(`Create a copy of "${name}"?\n\nSettings, audience criteria and the message sequence are copied. The audience leads are NOT — the copy starts as a Draft so you can review and launch it.`)) return;
    try {
      const r = await api.post<{ id: string; name: string }>(`/linkedin/campaigns/${id}/duplicate`, {});
      await load();
      alert(`Created "${r.name}" as a Draft.`);
    } catch (e: any) { alert(e?.message ?? 'Could not replicate the campaign'); }
  }
  async function respace(id: string) {
    if (!confirm('Re-space this campaign’s pending connection requests evenly across working days?\n\nThis redistributes invites that are still waiting to send (fixes single-day pile-ups). Nothing is sent now, and already-sent invites are untouched.')) return;
    try {
      const r = await api.post<{ ok: boolean; respaced: number; message?: string }>(`/linkedin/campaigns/${id}/respace`, {});
      alert(r.ok ? `Re-spaced ${r.respaced} pending invite${r.respaced === 1 ? '' : 's'} across your working days.` : (r.message ?? 'Could not re-space.'));
    } catch (e: any) { alert(e?.message ?? 'Failed'); }
  }

  const emptyMsg = view === 'deleted' ? 'No deleted campaigns.' : view === 'archived' ? 'No archived campaigns.' : view === 'completed' ? 'No completed campaigns.' : 'No campaigns yet.';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {CAMPAIGN_TABS.map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${view === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        <Link href={`/linkedin/${clientId}/campaigns/new`} className="btn-primary">+ New Campaign</Link>
      </div>
      {!loaded ? <EmptyState message="Loading…" /> : campaigns.length === 0 ? (
        <EmptyState message={emptyMsg} />
      ) : (
        <div className="card divide-y divide-slate-100">
          {campaigns.map((c) => (
            <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link href={`/linkedin/${clientId}/campaigns/${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">{c.name}</Link>
                {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
                <span className="text-xs text-slate-400">{c.outreachType === 'DIRECT_MESSAGES' ? 'Direct' : 'Connect'}</span>
                {c.linkedInAccount?.fullName && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500" title="LinkedIn seat">👤 {c.linkedInAccount.fullName}</span>
                )}
                {!c.linkedInAccount && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600" title="Its LinkedIn account was removed — open the campaign to attach one">⚠ No account</span>
                )}
                {view === 'deleted' && c.deletedAt && <span className="text-xs text-rose-400">deleted {timeAgo(c.deletedAt)} · expires in {purgeCountdown(c.deletedAt)} days</span>}
                {(c.status === 'RUNNING' || c.status === 'PAUSED') && <LiScheduleStatus campaignId={c.id} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-500">{c._count?.leads ?? 0} leads</span>
                <StatusBadge status={c.status} />
                {view === 'deleted' ? (
                  <>
                    <button className="btn-ghost px-2 py-1 text-sm" onClick={() => act(c.id, 'restore')}>♻ Restore</button>
                    {canDelete && <button className="px-2 py-1 text-sm text-rose-600 hover:text-rose-800" onClick={() => hardDel(c.id, c.name)}>Delete Forever</button>}
                  </>
                ) : view === 'archived' ? (
                  <>
                    <Link href={`/linkedin/${clientId}/campaigns/${c.id}`} className="btn-ghost px-2 py-1 text-sm">View</Link>
                    <button className="btn-ghost px-2 py-1 text-sm" onClick={() => act(c.id, 'restore')}>♻ Restore</button>
                    {canDelete && <button className="px-2 py-1 text-sm text-rose-500 hover:text-rose-700" onClick={() => del(c.id, c.name)}>Delete</button>}
                  </>
                ) : (
                  <>
                    <Link href={`/linkedin/${clientId}/campaigns/${c.id}`} className="btn-ghost px-2 py-1 text-sm">View</Link>
                    {(c.status === 'DRAFT' || c.status === 'PAUSED') && (
                      <Link href={`/linkedin/${clientId}/campaigns/${c.id}/edit`} className="btn-ghost px-2 py-1 text-sm">Edit</Link>
                    )}
                    {c.status === 'RUNNING' && (
                      <button className="btn-ghost px-2 py-1 text-sm" onClick={() => sendNext(c.id)} title="Send the next scheduled action immediately (test)">⚡ Send next</button>
                    )}
                    {(c.status === 'RUNNING' || c.status === 'PAUSED') && (
                      <button className="btn-ghost px-2 py-1 text-sm" onClick={() => respace(c.id)} title="Re-spread pending invites evenly across working days (fix pile-ups)">↔ Re-space</button>
                    )}
                    {c.status === 'RUNNING' ? (
                      <button className="btn-ghost px-2 py-1" onClick={() => act(c.id, 'pause')}>⏸ Pause</button>
                    ) : (
                      <button className="btn-primary px-2 py-1" onClick={() => act(c.id, 'resume')}>▶ Start</button>
                    )}
                    <button className="btn-ghost px-2 py-1 text-sm" onClick={() => replicate(c.id, c.name)} title="Create a copy with the same settings, audience criteria and messages">⧉ Replicate</button>
                    {(c.status === 'DRAFT' || c.status === 'PAUSED' || c.status === 'COMPLETED') && (
                      <button className="btn-ghost px-2 py-1 text-sm" onClick={() => act(c.id, 'archive')}>Archive</button>
                    )}
                    {canDelete && <button className="px-2 py-1 text-sm text-rose-500 hover:text-rose-700" onClick={() => del(c.id, c.name)}>Delete</button>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── small helpers ────────────────────────────────────────────────────────
function Stat({ label, value, sub, action }: { label: string; value: React.ReactNode; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        {action}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/** "12 days left" / "Expired" caption for the shared client plan validity. */
function validityLeft(days?: number | null, startAt?: string | null): string | undefined {
  if (!days || !startAt) return 'No expiry set';
  const left = Math.ceil((new Date(startAt).getTime() + days * 86_400_000 - Date.now()) / 86_400_000);
  return left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'Expired';
}

type SchedStatus = {
  scheduledThrough: string | null;
  today: { date: string; scheduled: number; sent: number; cap: number } | null;
  next: { date: string; scheduled: number; cap: number };
  pending: number;
};

/** Daily-pull schedule status under a RUNNING campaign: today sent/planned vs cap, the
 *  next working day's planned count, and the pending-bucket size. */
function LiScheduleStatus({ campaignId }: { campaignId: string }) {
  const [s, setS] = useState<SchedStatus | null>(null);
  useEffect(() => {
    api.get<SchedStatus>(`/linkedin/campaigns/${campaignId}/schedule-status`).then(setS).catch(() => {});
  }, [campaignId]);
  if (!s) return null;
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  return (
    <div className="mt-1 w-full text-xs text-slate-500">
      <span title="Connection requests sent / planned today, vs the daily cap">
        📅 Today <strong className="text-slate-700">{s.today ? `${s.today.sent}/${s.today.scheduled}` : '—'}</strong>
        {s.today ? <span className="text-slate-400"> (cap {s.today.cap})</span> : ' (off day)'}
      </span>
      <span className="mx-2 text-slate-300">·</span>
      <span title="Planned for the next working day (evening pull)">
        Next <span className="text-slate-400">{day(s.next.date)}</span> <strong className="text-slate-700">{s.next.scheduled}</strong>
      </span>
      <span className="mx-2 text-slate-300">·</span>
      <span title="Leads waiting in the pending bucket">Pending <strong className="text-slate-700">{s.pending}</strong></span>
    </div>
  );
}
