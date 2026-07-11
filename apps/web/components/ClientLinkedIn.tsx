'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { EmptyState, StatusBadge, Tabs, PageHeader } from '@/components/ui';
import { LiInbox } from '@/components/LiInbox';
import { LiRegularWizard } from '@/components/LiRegularWizard';
import { LiAiWizard } from '@/components/LiAiWizard';
import { LiCampaignDetailView } from '@/components/LiCampaignDetailView';
import { LiSubscription, LiKnowledgeStats, LiCampaign, LinkedInAccount, accountHealth, timeAgo } from '@/lib/linkedin';
import { validityInfo } from '@/components/Validity';

const BASE = '/linkedin/portal';

export function ClientLinkedIn({ clientId }: { clientId: string }) {
  const [sub, setSub] = useState<LiSubscription | null>(null);
  const [stats, setStats] = useState<LiKnowledgeStats | null>(null);
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [view, setView] = useState('campaigns');

  useEffect(() => {
    api.get<LiSubscription>(`${BASE}/clients/${clientId}/subscription`).then(setSub).catch(() => {});
    api.get<LiKnowledgeStats>(`${BASE}/clients/${clientId}/knowledge-stats`).then(setStats).catch(() => {});
    api.get<LinkedInAccount[]>(`${BASE}/clients/${clientId}/linkedin-accounts`).then(setAccounts).catch(() => {});
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
          { key: 'inbox', label: 'Inbox' },
          { key: 'accounts', label: 'Accounts', count: accounts.length || undefined },
        ]}
        active={view}
        onChange={setView}
      />
      {view === 'campaigns' && <ClientCampaigns clientId={clientId} />}
      {view === 'inbox' && <LiInbox clientId={clientId} base={BASE} />}
      {view === 'accounts' && <ClientAccounts accounts={accounts} />}
    </div>
  );
}

/** Read-only list of the client's connected LinkedIn accounts (seats). */
function ClientAccounts({ accounts }: { accounts: LinkedInAccount[] }) {
  if (accounts.length === 0) {
    return <EmptyState message="No LinkedIn accounts connected yet. Your account team connects your seats for you." />;
  }
  return (
    <div className="card divide-y divide-slate-100">
      {accounts.map((a) => {
        const h = accountHealth(a.status, a.deactivated);
        return (
          <div key={a.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <img src={a.avatarUrl || 'https://placehold.co/40x40/ede9fe/6d28d9?text=in'} alt="" className="h-10 w-10 rounded-full bg-brand-50 object-cover" />
              <div>
                <div className="font-medium text-slate-800">{a.fullName ?? 'Pending connection…'}</div>
                <div className="line-clamp-1 text-xs text-slate-500">
                  {a.headline ?? (a.status === 'CONNECTED' ? 'LinkedIn account' : 'Awaiting LinkedIn auth')}
                  {a.connectionsCount != null && ` · ${a.connectionsCount} connections`}
                  {a.status === 'CONNECTED' && ` · synced ${timeAgo(a.lastSyncedAt)}`}
                </div>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium ${h.text}`}>
              <span className={`h-2 w-2 rounded-full ${h.dot}`} />{h.label}
            </span>
          </div>
        );
      })}
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

  const load = useCallback(async () => {
    setCampaigns(await api.get<LiCampaign[]>(`${BASE}/campaigns?clientId=${clientId}`));
    setLoaded(true);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, path: string, okMsg?: string) {
    setBusy(id + path);
    try { await api.post(`${BASE}/campaigns/${id}/${path}`); if (okMsg) alert(okMsg); await load(); }
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

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating('REGULAR')}>+ New Campaign</button>
      </div>
      {campaigns.length === 0 ? (
        <EmptyState message="No LinkedIn campaigns yet. Click “New Campaign” to build one — it’ll go to your account team for approval before launch." />
      ) : (
      <div className="card divide-y divide-slate-100">
      {campaigns.map((c) => (
        <div key={c.id} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">{c.name}</span>
            {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
            {c.linkedInAccount?.fullName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500" title="LinkedIn seat">👤 {c.linkedInAccount.fullName}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{c._count?.leads ?? 0} leads</span>
            <StatusBadge status={c.status} />
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setViewId(c.id)}>View</button>
            {c.pendingApproval && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">⏳ Under review</span>}
            {!c.pendingApproval && (c.status === 'DRAFT' || c.status === 'PAUSED') && <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditId(c.id)}>Edit</button>}
            {!c.pendingApproval && c.status === 'DRAFT' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'submit', 'Submitted for approval — your account team will review it.')}>Submit for approval</button>}
            {c.status === 'RUNNING' && <button className="btn-ghost px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'pause')}>⏸ Pause</button>}
            {c.status === 'PAUSED' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'resume')}>▶ Resume</button>}
          </div>
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
