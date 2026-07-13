'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, Tabs, Pagination } from '@/components/ui';
import { LiImportLeadsModal } from '@/components/LiImportLeadsModal';
import { LiCampaignSummary } from '@/components/LiCampaignSummary';
import { ConnectionPerformanceChart, EngagementVolumeChart } from '@/components/LiCampaignCharts';
import { LiCampaignDetail, LiCampaignStats, LiLeadsPage, parseLeadTitleCompany } from '@/lib/linkedin';

// Cumulative pipeline (WDC-style): Sent = connection-sent-or-beyond, Connected =
// connected-or-beyond, Messaged = messaged-or-beyond. Counts come from cumulativeCounts.
const LEAD_TABS: { key: string; label: string; status?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', status: 'PENDING' },
  { key: 'sent', label: 'Sent', status: 'CONNECTION_PENDING' },
  { key: 'connected', label: 'Connected', status: 'CONNECTED' },
  { key: 'messaged', label: 'Messaged', status: 'MESSAGED' },
  { key: 'replied', label: 'Replied', status: 'REPLIED' },
  { key: 'completed', label: 'Completed', status: 'CAMPAIGN_COMPLETED' },
];
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONNECTION_PENDING: 'Sent', CONNECTED: 'Connected',
  MESSAGED: 'Messaged', REPLIED: 'Replied', CAMPAIGN_COMPLETED: 'Completed',
  BOUNCED: 'Bounced', EXCLUDED: 'Excluded',
};

/** KPIs + sentiment + Setup/Analytics/Details for a campaign. Shared by admin
 *  ('/linkedin') and the client portal ('/linkedin/portal'). */
const PERIODS: { key: string; label: string }[] = [
  { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'lifetime', label: 'Lifetime' }, { key: 'custom', label: 'Custom' },
];

export function LiCampaignDetailView({ campaignId, base = '/linkedin' }: { campaignId: string; base?: string }) {
  const [c, setC] = useState<LiCampaignDetail | null>(null);
  const [stats, setStats] = useState<LiCampaignStats | null>(null);
  const [view, setView] = useState('setup');
  const [period, setPeriod] = useState('lifetime');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    api.get<LiCampaignDetail>(`${base}/campaigns/${campaignId}`).then(setC).catch(() => {});
  }, [campaignId, base]);

  useEffect(() => {
    if (period === 'custom' && (!from || !to)) return;
    const qs = new URLSearchParams({ period });
    if (period === 'custom') { qs.set('from', from); qs.set('to', to); }
    api.get<LiCampaignStats>(`${base}/campaigns/${campaignId}/stats?${qs}`).then(setStats).catch(() => {});
  }, [campaignId, base, period, from, to]);

  if (!c || !stats) return <EmptyState message="Loading…" />;

  const periodSub = period === 'lifetime' ? 'in total' : period === 'custom' ? 'in range' : `this ${period}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 font-medium transition ${period === p.key ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <span className="flex items-center gap-1 text-sm">
            <input type="date" className="input py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400">→</span>
            <input type="date" className="input py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Connections Sent" value={stats.sent} sub={periodSub} />
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
        <Tabs tabs={[{ key: 'setup', label: 'Setup' }, { key: 'analytics', label: 'Analytics' }, { key: 'details', label: 'Details' }]} active={view} onChange={setView} />
        {view === 'setup' && <LiCampaignSummary campaignId={campaignId} base={base} />}
        {view === 'analytics' && <Analytics c={c} stats={stats} />}
        {view === 'details' && <Details campaignId={campaignId} base={base} />}
      </div>
    </div>
  );
}

function Analytics({ c, stats }: { c: LiCampaignDetail; stats: LiCampaignStats }) {
  const max = Math.max(stats.sent, 1);
  const series = stats.series ?? [];
  return (
    <div className="space-y-6">
      <ConnectionPerformanceChart series={series} />
      <div className="grid gap-6 md:grid-cols-2">
        <EngagementVolumeChart series={series} />
        <div className="card p-5">
          <h3 className="mb-1 font-semibold text-slate-800">Campaign Funnel</h3>
          <p className="mb-4 text-sm text-slate-400">Overall Conversion</p>
          <FunnelBar label="Sent" n={stats.sent} pct={100} color="bg-slate-400" />
          <FunnelBar label="Accepted" n={stats.accepted} pct={(stats.accepted / max) * 100} color="bg-emerald-500" note={`${stats.acceptanceRate}%`} />
          <FunnelBar label="Replied" n={stats.replied} pct={(stats.replied / max) * 100} color="bg-brand-600" note={`${stats.replyRate}%`} />
          {stats.replied > 0 && (
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{stats.sentiment.positive} positive</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" />{stats.sentiment.neutral} neutral</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />{stats.sentiment.negative} negative</span>
            </div>
          )}
        </div>
      </div>
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-slate-800">Sequence ({c.steps.length} steps)</h3>
        <ol className="space-y-2">
          {c.steps.map((s) => (
            <li key={s.id} className="flex gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs text-brand-700">{s.order}</span>
              <div>
                <div className="font-medium text-slate-800">{s.type === 'CONNECTION_REQUEST' ? 'Connection Request' : 'Message'}
                  {s.waitHours > 0 && <span className="font-normal text-slate-400"> · wait {s.waitHours}h</span>}
                  {s.variants && s.variants.length > 0 && <span className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">+{s.variants.length} wording{s.variants.length > 1 ? 's' : ''}</span>}</div>
                {(s.body || s.note) && <div className="line-clamp-2 text-slate-500">{s.body ?? s.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Details({ campaignId, base }: { campaignId: string; base: string }) {
  const isPortal = base.includes('/portal');
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LiLeadsPage | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');

  async function sourceFromAudience() {
    setSourcing(true);
    try {
      const r = await api.post<{ sourced: number; keywords: string; creditsCharged?: number }>(`${base}/campaigns/${campaignId}/source-leads?limit=25`, {});
      alert(r.sourced > 0
        ? `Added ${r.sourced} lead${r.sourced === 1 ? '' : 's'} from LinkedIn search (query: "${r.keywords}").${r.creditsCharged ? ' · 1 credit used.' : ''}`
        : `No new leads found for "${r.keywords}". Try broadening the campaign's audience.`);
      setTab('all'); setPage(1); setReloadKey((k) => k + 1);
    } catch (e: any) { alert(e.message ?? 'Sourcing failed'); }
    finally { setSourcing(false); }
  }

  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const status = LEAD_TABS.find((t) => t.key === tab)?.status;
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set('status', status);
    if (dq) qs.set('search', dq);
    api.get<LiLeadsPage>(`${base}/campaigns/${campaignId}/leads?${qs}`).then(setData);
  }, [campaignId, base, tab, page, dq, reloadKey]);

  const tabs = LEAD_TABS.map((t) => ({
    key: t.key, label: t.label,
    // Cumulative counts (Connected = connected-or-beyond, …); fall back to raw counts.
    count: t.key === 'all' ? data?.total : (data?.cumulativeCounts?.[t.status!] ?? data?.tabCounts?.[t.status!]),
  }));

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-800">Target Audience</h3>
        <div className="flex items-center gap-2">
          <input className="input w-56" placeholder="Search targets…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!isPortal && (
            <button className="btn-primary whitespace-nowrap" disabled={sourcing} onClick={sourceFromAudience}>
              {sourcing ? 'Sourcing…' : '✦ Source from audience'}
            </button>
          )}
          <button className="btn-ghost whitespace-nowrap" onClick={() => setImporting(true)}>⭳ Import leads</button>
        </div>
      </div>
      {importing && (
        <LiImportLeadsModal
          campaignId={campaignId}
          base={base}
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
            {data?.items.map((l) => {
              const tc = parseLeadTitleCompany(l.title, l.company);
              return (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="p-3"><div className="max-w-[200px] truncate font-medium text-slate-800" title={l.fullName}>{l.fullName}</div></td>
                <td className="p-3">
                  {l.profileUrl
                    ? <a href={l.profileUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-brand-600 hover:text-brand-800 hover:underline">View Profile</a>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="p-3"><div className="max-w-[300px] truncate text-slate-600" title={tc.title}>{tc.title}</div></td>
                <td className="p-3"><div className="max-w-[170px] truncate text-slate-600" title={tc.company}>{tc.company}</div></td>
                <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[l.status] ?? l.status}</span></td>
                <td className="p-3 text-slate-500">{l.currentStep}</td>
              </tr>
              );
            })}
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
function FunnelBar({ label, n, pct, color, note }: { label: string; n: number; pct: number; color: string; note?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">{n}{note && <span className="ml-1 font-normal text-slate-400">({note})</span>}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100"><div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
    </div>
  );
}
