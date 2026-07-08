'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge, Tabs, Pagination } from '@/components/ui';
import { LiImportLeadsModal } from '@/components/LiImportLeadsModal';
import { LiCampaignDetail, LiCampaignStats, LiLeadsPage } from '@/lib/linkedin';

const LEAD_TABS: { key: string; label: string; status?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', status: 'PENDING' },
  { key: 'sent', label: 'Sent', status: 'CONNECTION_PENDING' },
  { key: 'connected', label: 'Connected', status: 'CONNECTED' },
  { key: 'messaged', label: 'Messaged', status: 'MESSAGED' },
  { key: 'replied', label: 'Replied', status: 'REPLIED' },
];
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONNECTION_PENDING: 'Sent', CONNECTED: 'Connected',
  MESSAGED: 'Messaged', REPLIED: 'Replied', BOUNCED: 'Bounced', EXCLUDED: 'Excluded',
};

export default function LiCampaignDetailPage() {
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId: string }>();
  const [c, setC] = useState<LiCampaignDetail | null>(null);
  const [stats, setStats] = useState<LiCampaignStats | null>(null);
  const [view, setView] = useState('analytics');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cd, st] = await Promise.all([
      api.get<LiCampaignDetail>(`/linkedin/campaigns/${campaignId}`),
      api.get<LiCampaignStats>(`/linkedin/campaigns/${campaignId}/stats`),
    ]);
    setC(cd); setStats(st);
  }, [campaignId]);
  useEffect(() => { load(); }, [load]);

  if (!c || !stats) return <EmptyState message="Loading…" />;

  const running = c.status === 'RUNNING';
  async function toggle() {
    setBusy(true);
    try { await api.post(`/linkedin/campaigns/${campaignId}/${running ? 'pause' : 'resume'}`); await load(); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <Link href={`/linkedin/${clientId}`} className="text-sm text-slate-500 hover:text-slate-800">← Back to client</Link>
      <PageHeader
        title={c.name}
        subtitle={`${c.linkedInAccount?.fullName ?? ''} · ${c.timezone} · ${c.outreachType === 'DIRECT_MESSAGES' ? 'Direct Messages' : 'With Connection'}`}
        action={
          <div className="flex items-center gap-3">
            {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
            <StatusBadge status={c.status} />
            <button className={running ? 'btn-ghost' : 'btn-primary'} disabled={busy || c.status === 'ARCHIVED'} onClick={toggle}>
              {running ? '⏸ Pause' : '▶ Start'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Connections Sent" value={stats.sent} sub="in total" />
        <Kpi label="Acceptance Rate" value={`${stats.acceptanceRate}%`} sub={`${stats.accepted} accepted`} />
        <Kpi label="Reply Rate" value={`${stats.replyRate}%`} sub={`${stats.replied} replies`} />
        <Kpi label="Total Messages" value={stats.totalMessages} sub="sent & received" />
      </div>

      <div className="mt-4 flex gap-3">
        <Pill color="emerald" label="Positive" n={stats.sentiment.positive} />
        <Pill color="slate" label="Neutral" n={stats.sentiment.neutral} />
        <Pill color="rose" label="Negative" n={stats.sentiment.negative} />
      </div>

      <div className="mt-6">
        <Tabs tabs={[{ key: 'analytics', label: 'Analytics' }, { key: 'details', label: 'Details' }]} active={view} onChange={setView} />
        {view === 'analytics' ? <Analytics c={c} stats={stats} /> : <Details campaignId={campaignId} />}
      </div>
    </div>
  );
}

function Analytics({ c, stats }: { c: LiCampaignDetail; stats: LiCampaignStats }) {
  const max = Math.max(stats.sent, 1);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-slate-800">Campaign Funnel</h3>
        <FunnelBar label="Sent" n={stats.sent} pct={100} color="bg-slate-400" />
        <FunnelBar label="Accepted" n={stats.accepted} pct={(stats.accepted / max) * 100} color="bg-emerald-500" />
        <FunnelBar label="Replied" n={stats.replied} pct={(stats.replied / max) * 100} color="bg-brand-600" />
      </div>
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-slate-800">Sequence ({c.steps.length} steps)</h3>
        <ol className="space-y-2">
          {c.steps.map((s) => (
            <li key={s.id} className="flex gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs text-brand-700">{s.order}</span>
              <div>
                <div className="font-medium text-slate-800">{s.type === 'CONNECTION_REQUEST' ? 'Connection Request' : 'Message'}
                  {s.waitHours > 0 && <span className="font-normal text-slate-400"> · wait {s.waitHours}h</span>}</div>
                {(s.body || s.note) && <div className="line-clamp-2 text-slate-500">{s.body ?? s.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Details({ campaignId }: { campaignId: string }) {
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LiLeadsPage | null>(null);
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const status = LEAD_TABS.find((t) => t.key === tab)?.status;
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set('status', status);
    if (dq) qs.set('search', dq);
    api.get<LiLeadsPage>(`/linkedin/campaigns/${campaignId}/leads?${qs}`).then(setData);
  }, [campaignId, tab, page, dq, reloadKey]);

  const tabs = LEAD_TABS.map((t) => ({
    key: t.key, label: t.label,
    count: t.key === 'all' ? data?.total : data?.tabCounts?.[t.status!],
  }));

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-800">Target Audience</h3>
        <div className="flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="Search targets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-primary whitespace-nowrap" onClick={() => setImporting(true)}>⭳ Import leads</button>
        </div>
      </div>
      {importing && (
        <LiImportLeadsModal
          campaignId={campaignId}
          base="/linkedin"
          onClose={() => setImporting(false)}
          onImported={() => { setImporting(false); setPage(1); setTab('all'); setReloadKey((k) => k + 1); }}
        />
      )}
      <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-400">
            <tr>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Profile</th>
              <th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Company</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Step</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="p-3 font-medium text-slate-800">{l.fullName}</td>
                <td className="p-3">
                  {l.profileUrl
                    ? <a href={l.profileUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-800 hover:underline">View Profile</a>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="p-3 text-slate-600">{l.title ?? '—'}</td>
                <td className="p-3 text-slate-600">{l.company ?? '—'}</td>
                <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[l.status] ?? l.status}</span></td>
                <td className="p-3 text-slate-500">{l.currentStep}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">{dq ? 'No targets match your search.' : 'No leads in this view.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
function Pill({ color, label, n }: { color: 'emerald' | 'slate' | 'rose'; label: string; n: number }) {
  const cls = { emerald: 'bg-emerald-50 text-emerald-700', slate: 'bg-slate-100 text-slate-600', rose: 'bg-rose-50 text-rose-700' }[color];
  return <div className={`rounded-lg px-3 py-1.5 text-sm font-medium ${cls}`}>{label} <span className="ml-1 font-bold">{n}</span></div>;
}
function FunnelBar({ label, n, pct, color }: { label: string; n: number; pct: number; color: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">{label}</span><span className="font-semibold text-slate-800">{n}</span></div>
      <div className="h-2.5 rounded-full bg-slate-100"><div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
    </div>
  );
}
