'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { EmptyState, StatusBadge, Tabs, PageHeader } from '@/components/ui';
import { LiInbox } from '@/components/LiInbox';
import { LiRegularWizard } from '@/components/LiRegularWizard';
import { LiAiWizard } from '@/components/LiAiWizard';
import { LiCampaignDetailView } from '@/components/LiCampaignDetailView';
import { LiSubscription, LiKnowledgeStats, LiCampaign, accountHealth, timeAgo, purgeCountdown } from '@/lib/linkedin';
import { LinkedInAccounts, useLinkedInAccounts } from '@/components/LinkedInAccounts';
import { validityInfo } from '@/components/Validity';

const BASE = '/linkedin/portal';

export function ClientLinkedIn({ clientId }: { clientId: string }) {
  const [sub, setSub] = useState<LiSubscription | null>(null);
  const [stats, setStats] = useState<LiKnowledgeStats | null>(null);
  const [view, setView] = useState('campaigns');

  // Accounts (seats) live in the shared hook so the health strip + tab count stay
  // live across every tab, and the Accounts tab reuses the same connect/poll logic.
  const li = useLinkedInAccounts({ base: BASE, clientId, mode: 'popup' });
  const accounts = li.accounts;

  useEffect(() => {
    api.get<LiSubscription>(`${BASE}/clients/${clientId}/subscription`).then(setSub).catch(() => {});
    api.get<LiKnowledgeStats>(`${BASE}/clients/${clientId}/knowledge-stats`).then(setStats).catch(() => {});
  }, [clientId]);

  const connected = accounts.filter((a) => a.status === 'CONNECTED').length;
  const attention = accounts.filter((a) => accountHealth(a.status).attention).length;

  // Plan validity = shared client window (same as email), not the LinkedIn-only field.
  const v = validityInfo(sub?.clientValidityDays, sub?.clientValidityStartAt);
  const planValidity = {
    label: v.none ? '—' : `${v.days}`,
    sub: v.none ? 'No expiry set' : v.remaining != null ? (v.expired ? 'Expired' : `${v.remaining} days left`) : undefined,
  };

  return (
    <div>
      {/* Subscription strip (read-only; managed by your account team) */}
      <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Seats" value={sub?.seats ?? '—'} />
        <Stat label="Credits" value={sub?.creditsBalance ?? '—'} />
        <Stat label="Plan validity (days)" value={planValidity.label} sub={planValidity.sub} />
        <Stat label="AI Knowledge" value={`${stats?.aiKnowledgePct ?? 0}%`} sub={`${stats?.profileCount ?? 0} profiles`} />
      </div>

      {/* LinkedIn account health */}
      {accounts.length > 0 && (
        <div className={`mb-5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${attention > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <span className={`h-2 w-2 rounded-full ${attention > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          {connected} of {accounts.length} LinkedIn account{accounts.length === 1 ? '' : 's'} connected
          {attention > 0 && ' — one needs attention; your account team has been notified.'}
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'campaigns', label: 'Campaigns' },
          { key: 'schedule', label: 'Schedule' },
          { key: 'inbox', label: 'Inbox' },
          { key: 'accounts', label: 'Accounts', count: accounts.length || undefined },
        ]}
        active={view}
        onChange={setView}
      />
      {view === 'campaigns' && <ClientCampaigns clientId={clientId} />}
      {view === 'schedule' && <ClientSchedule clientId={clientId} />}
      {view === 'inbox' && <LiInbox clientId={clientId} base={BASE} />}
      {view === 'accounts' && <LinkedInAccounts li={li} mode="popup" seats={sub?.seats} />}
    </div>
  );
}


function ClientCampaigns({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<LiCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState<'choose' | 'REGULAR' | 'AI' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [tab, setTab] = useState('ongoing');

  const load = useCallback(async () => {
    setLoaded(false);
    setCampaigns(await api.get<LiCampaign[]>(`${BASE}/campaigns?clientId=${clientId}&view=${tab}`));
    setLoaded(true);
  }, [clientId, tab]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, path: string, okMsg?: string) {
    setBusy(id + path);
    try {
      const r = await api.post<{ pendingApproval?: boolean; message?: string }>(`${BASE}/campaigns/${id}/${path}`);
      if (r?.pendingApproval) alert(r.message ?? 'Sent for approval.');
      else if (okMsg) alert(okMsg);
      await load();
    }
    catch (e: any) { alert(e.message ?? 'Action failed'); }
    finally { setBusy(''); }
  }

  const finishCreate = () => { setCreating(null); load(); };

  // AI Mode is hidden for now — "New Campaign" goes straight to Regular mode.
  // To re-enable AI, set the button below back to setCreating('choose') and
  // restore the 'AI' + 'choose' branches (see the commented block).
  if (editId) return <LiRegularWizard clientId={clientId} base={BASE} launchMode="submit" editCampaignId={editId} onBack={() => setEditId(null)} onDone={() => { setEditId(null); load(); }} />;
  if (creating === 'REGULAR') return <LiRegularWizard clientId={clientId} base={BASE} launchMode="submit" onBack={() => setCreating(null)} onDone={finishCreate} />;
  /* ── Mode picker (Regular vs AI) — hidden while we focus on Regular mode ──
  if (creating === 'AI') {
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => setCreating('choose')} className="text-sm text-slate-500 hover:text-slate-800">← Change mode</button>
        <PageHeader title="New LinkedIn Campaign · AI Mode" subtitle="Let AI build the campaign from your business DNA." />
        <LiAiWizard clientId={clientId} base={BASE} launchMode="submit" onDone={finishCreate} />
      </div>
    );
  }
  if (creating === 'choose') {
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => setCreating(null)} className="text-sm text-slate-500 hover:text-slate-800">← Back to campaigns</button>
        <PageHeader title="New LinkedIn Campaign" subtitle="How do you want to create this campaign?" />
        <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={() => setCreating('REGULAR')} className="card p-6 text-left transition hover:border-brand-300">
            <div className="mb-2 text-2xl">📄</div>
            <div className="text-lg font-semibold text-slate-800">Regular Mode</div>
            <div className="text-sm text-slate-500">Define your target audience and messages manually.</div>
          </button>
          <button onClick={() => setCreating('AI')} className="card p-6 text-left transition hover:border-brand-300">
            <div className="mb-2 text-2xl">✦</div>
            <div className="text-lg font-semibold text-slate-800">AI Mode</div>
            <div className="text-sm text-slate-500">Let AI define your campaign from your business DNA.</div>
          </button>
        </div>
      </div>
    );
  }
  */

  if (!loaded) return <EmptyState message="Loading…" />;

  // Full campaign detail (mirrors the admin campaign page).
  if (viewId) {
    const c = campaigns.find((x) => x.id === viewId);
    if (!c) { setViewId(null); return null; }
    return (
      <div>
        <button onClick={() => { setViewId(null); load(); }} className="text-sm text-slate-500 hover:text-slate-800">← Back to campaigns</button>
        <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{c.name}</h2>
            <div className="text-sm text-slate-500">
              {c.linkedInAccount?.fullName ? `${c.linkedInAccount.fullName} · ` : ''}
              {c.outreachType === 'DIRECT_MESSAGES' ? 'Direct Messages' : 'With Connection'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={c.status} />
            {c.pendingApproval && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">⏳ Under review</span>}
            {!c.pendingApproval && (c.status === 'DRAFT' || c.status === 'PAUSED') && <button className="btn-ghost px-3 py-1.5" onClick={() => { setViewId(null); setEditId(c.id); }}>Edit</button>}
            {!c.pendingApproval && c.status === 'DRAFT' && <button className="btn-primary px-3 py-1.5" disabled={busy !== ''} onClick={() => act(c.id, 'submit', 'Submitted for approval — your account team will review it.')}>Submit for approval</button>}
            {c.status === 'RUNNING' && <button className="btn-ghost px-3 py-1.5" disabled={busy !== ''} onClick={() => act(c.id, 'pause')}>⏸ Pause</button>}
            {c.status === 'PAUSED' && <button className="btn-primary px-3 py-1.5" disabled={busy !== ''} onClick={() => act(c.id, 'resume')}>▶ Resume</button>}
          </div>
        </div>
        <LiCampaignDetailView campaignId={c.id} base={BASE} />
      </div>
    );
  }

  const CT: [string, string][] = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['archived', 'Archived'], ['deleted', 'Deleted']];
  const delCampaign = (id: string) => { if (confirm('Delete this campaign? It moves to the Deleted tab — you can restore it there.')) act(id, 'delete'); };
  const emptyMsg = tab === 'deleted' ? 'No deleted campaigns.' : tab === 'archived' ? 'No archived campaigns.' : tab === 'completed' ? 'No completed campaigns yet.' : 'No LinkedIn campaigns yet. Click “New Campaign” to build one — it’ll go to your account team for approval before launch.';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {CT.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setCreating('REGULAR')}>+ New Campaign</button>
      </div>
      {!loaded ? <EmptyState message="Loading…" /> : campaigns.length === 0 ? (
        <EmptyState message={emptyMsg} />
      ) : (
      <div className="card divide-y divide-slate-100">
      {campaigns.map((c) => (
        <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{c.name}</span>
            {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
            {c.linkedInAccount?.fullName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500" title="LinkedIn seat">👤 {c.linkedInAccount.fullName}</span>
            )}
            {tab === 'deleted' && c.deletedAt && <span className="text-xs text-rose-400">deleted {timeAgo(c.deletedAt)} · expires in {purgeCountdown(c.deletedAt)} days</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">{c._count?.leads ?? 0} leads</span>
            <StatusBadge status={c.status} />
            {tab === 'deleted' ? (
              <button className="btn-ghost px-2 py-1 text-sm" disabled={busy !== ''} onClick={() => act(c.id, 'restore')}>♻ Restore</button>
            ) : tab === 'archived' ? (
              <>
                <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setViewId(c.id)}>View</button>
                <button className="btn-ghost px-2 py-1 text-sm" disabled={busy !== ''} onClick={() => act(c.id, 'restore')}>♻ Restore</button>
                <button className="px-2 py-1 text-sm text-rose-500 hover:text-rose-700" disabled={busy !== ''} onClick={() => delCampaign(c.id)}>Delete</button>
              </>
            ) : (
              <>
                <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setViewId(c.id)}>View</button>
                {c.pendingApproval && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">⏳ Under review</span>}
                {!c.pendingApproval && (c.status === 'DRAFT' || c.status === 'PAUSED') && <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditId(c.id)}>Edit</button>}
                {!c.pendingApproval && c.status === 'DRAFT' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'submit', 'Submitted for approval — your account team will review it.')}>Submit for approval</button>}
                {c.status === 'RUNNING' && <button className="btn-ghost px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'pause')}>⏸ Pause</button>}
                {c.status === 'PAUSED' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'resume')}>▶ Resume</button>}
                {!c.pendingApproval && (c.status === 'DRAFT' || c.status === 'PAUSED' || c.status === 'COMPLETED') && <button className="btn-ghost px-2 py-1 text-sm" disabled={busy !== ''} onClick={() => act(c.id, 'archive')}>Archive</button>}
                <button className="px-2 py-1 text-sm text-rose-500 hover:text-rose-700" disabled={busy !== ''} onClick={() => delCampaign(c.id)}>Delete</button>
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

/** Read-only upcoming send schedule + forecast for the client's own campaigns. */
function ClientSchedule({ clientId }: { clientId: string }) {
  const [data, setData] = useState<{ items: any[]; dailyTotals: any[] } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  useEffect(() => {
    api.get<{ items: any[]; dailyTotals: any[] }>(`${BASE}/clients/${clientId}/schedule`).then(setData).catch(() => {});
  }, [clientId]);
  if (!data) return <EmptyState message="Loading…" />;
  const totals = data.dailyTotals ?? [];
  const items = data.items ?? [];
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hr = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  return (
    <div>
      {totals.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Daily send total · 🔗 invites · ✉ messages · 👤 leads</div>
          <div className="flex flex-wrap gap-2">
            {totals.map((t) => (
              <div key={t.date} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                <div className="font-semibold text-slate-700">{fmtDay(t.date)}</div>
                <div className="mt-0.5 text-slate-600">🔗 {t.connections} · ✉ {t.messages}</div>
                <div className="text-[11px] text-slate-400">👤 {t.leads} leads</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState message="No scheduled sends yet. Once a campaign is running, its upcoming sends appear here." />
      ) : (
        <div className="card divide-y divide-slate-100">
          {items.map((c) => (
            <div key={c.id}>
              <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {!!c.forecast?.length && <button onClick={() => toggle(c.id)} className="text-slate-400 hover:text-slate-700">{open.has(c.id) ? '▾' : '▸'}</button>}
                  <span className="font-medium text-slate-800">{c.name}</span>
                  {c.seat && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">👤 {c.seat}</span>}
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span>{c.run247 ? '24/7' : `${hr(c.workStartHour)}–${hr(c.workEndHour)}`}</span>
                  <span>{c.nextSendAt ? `Next: ${new Date(c.nextSendAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No upcoming send'}</span>
                </div>
              </div>
              {open.has(c.id) && !!c.forecast?.length && (
                <div className="bg-slate-50/60 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {c.forecast.map((f: any) => (
                      <div key={f.date} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <div className="font-medium text-slate-700">{fmtDay(f.date)}</div>
                        <div className="mt-0.5 text-slate-500">🔗 {f.connections} · ✉ {f.messages} · 👤 {f.leads}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
