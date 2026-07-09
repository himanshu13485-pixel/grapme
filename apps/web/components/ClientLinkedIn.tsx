'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { EmptyState, StatusBadge, Tabs, Pagination, PageHeader } from '@/components/ui';
import { LiInbox } from '@/components/LiInbox';
import { LiRegularWizard } from '@/components/LiRegularWizard';
import { LiAiWizard } from '@/components/LiAiWizard';
import { LiImportLeadsModal } from '@/components/LiImportLeadsModal';
import { LiSubscription, LiKnowledgeStats, LiCampaign, LiCampaignStats, LiLeadsPage, LinkedInAccount, accountHealth } from '@/lib/linkedin';

const BASE = '/linkedin/portal';
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONNECTION_PENDING: 'Sent', CONNECTED: 'Connected',
  MESSAGED: 'Messaged', REPLIED: 'Replied',
};

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

  return (
    <div>
      {/* Subscription strip (read-only; managed by your account team) */}
      <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Seats" value={sub?.seats ?? '—'} />
        <Stat label="Credits" value={sub?.creditsBalance ?? '—'} />
        <Stat label="Validity (days)" value={sub?.validityDays ?? '—'} />
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

      <Tabs tabs={[{ key: 'campaigns', label: 'Campaigns' }, { key: 'inbox', label: 'Inbox' }]} active={view} onChange={setView} />
      {view === 'campaigns' ? <ClientCampaigns clientId={clientId} /> : <LiInbox clientId={clientId} base={BASE} />}
    </div>
  );
}

function ClientCampaigns({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<LiCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
        <div key={c.id}>
          <div className="flex items-center justify-between p-4">
            <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="flex items-center gap-2 text-left">
              <span className="font-medium text-slate-800">{c.name}</span>
              {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
              <span className="text-xs text-slate-400">{openId === c.id ? '▲' : '▼'}</span>
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">{c._count?.leads ?? 0} leads</span>
              <StatusBadge status={c.status} />
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setOpenId(openId === c.id ? null : c.id)}>{openId === c.id ? 'Hide' : 'View'}</button>
              {c.status === 'DRAFT' && <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditId(c.id)}>Edit</button>}
              {c.status === 'DRAFT' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'submit', 'Submitted for approval — your account team will review it.')}>Submit for approval</button>}
              {c.status === 'RUNNING' && <button className="btn-ghost px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'pause')}>⏸ Pause</button>}
              {c.status === 'PAUSED' && <button className="btn-primary px-2 py-1" disabled={busy !== ''} onClick={() => act(c.id, 'resume')}>▶ Resume</button>}
            </div>
          </div>
          {openId === c.id && <CampaignDetail campaignId={c.id} onChanged={load} />}
        </div>
      ))}
      </div>
      )}
    </div>
  );
}

function CampaignDetail({ campaignId, onChanged }: { campaignId: string; onChanged?: () => void }) {
  const [stats, setStats] = useState<LiCampaignStats | null>(null);
  const [leads, setLeads] = useState<LiLeadsPage | null>(null);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { api.get<LiCampaignStats>(`${BASE}/campaigns/${campaignId}/stats`).then(setStats); }, [campaignId, reloadKey]);
  useEffect(() => { api.get<LiLeadsPage>(`${BASE}/campaigns/${campaignId}/leads?page=${page}`).then(setLeads); }, [campaignId, page, reloadKey]);

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 p-4">
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="Sent" value={stats.sent} />
          <Mini label="Acceptance" value={`${stats.acceptanceRate}%`} />
          <Mini label="Reply Rate" value={`${stats.replyRate}%`} />
          <Mini label="Messages" value={stats.totalMessages} />
        </div>
      )}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-slate-500">{leads?.total ?? 0} lead{leads?.total === 1 ? '' : 's'}</div>
        <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setImporting(true)}>⭳ Import leads</button>
      </div>
      {importing && (
        <LiImportLeadsModal
          campaignId={campaignId}
          base={BASE}
          onClose={() => setImporting(false)}
          onImported={() => { setImporting(false); setPage(1); setReloadKey((k) => k + 1); onChanged?.(); }}
        />
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-400">
            <tr><th className="p-2 font-medium">Name</th><th className="p-2 font-medium">Company</th><th className="p-2 font-medium">Status</th></tr>
          </thead>
          <tbody>
            {leads?.items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="p-2 text-slate-800">{l.fullName}</td>
                <td className="p-2 text-slate-600">{l.company ?? '—'}</td>
                <td className="p-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[l.status] ?? l.status}</span></td>
              </tr>
            ))}
            {leads && leads.items.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-slate-400">No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {leads && <Pagination page={leads.page} pageSize={leads.pageSize} total={leads.total} onPage={setPage} />}
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
function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="card p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-bold text-slate-800">{value}</div></div>;
}
