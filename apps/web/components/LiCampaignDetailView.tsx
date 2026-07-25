'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, Tabs, Pagination } from '@/components/ui';
import { LiImportLeadsModal } from '@/components/LiImportLeadsModal';
import { LiCampaignSummary } from '@/components/LiCampaignSummary';
import { LiLeadLogModal } from '@/components/LiLeadLogModal';
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
  { key: 'not_accepted', label: 'Not accepted', status: 'NOT_ACCEPTED' },
];
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONNECTION_PENDING: 'Sent', CONNECTED: 'Connected',
  MESSAGED: 'Messaged', REPLIED: 'Replied', CAMPAIGN_COMPLETED: 'Completed',
  NOT_ACCEPTED: 'Not accepted', BOUNCED: 'Bounced', EXCLUDED: 'Excluded',
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
  const [syncing, setSyncing] = useState(false);
  const [importingConns, setImportingConns] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  // Admin-only bulk selection for removing targets (e.g. duplicates).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingNow, setSendingNow] = useState<string | null>(null);
  // Step + sent-date filters and the per-lead activity log.
  const [fStep, setFStep] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [logLead, setLogLead] = useState<{ id: string; name: string } | null>(null);

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api.post<{ ok: boolean; started?: boolean; total: number; checked: number; accepted: number; refreshed: number; messagesSynced: number; message?: string }>(`${base}/campaigns/${campaignId}/sync`, {});
      alert(!r.ok
        ? (r.message ?? 'Sync unavailable.')
        : r.started
          ? `Syncing all ${r.total} leads from LinkedIn in the background — reload the audience in a minute to see refreshed names, new connections and imported messages.`
          : `Synced ${r.total} lead${r.total === 1 ? '' : 's'}: ${r.refreshed} refreshed, ${r.accepted} newly connected (of ${r.checked} checked), ${r.messagesSynced} message${r.messagesSynced === 1 ? '' : 's'} imported.`);
      setReloadKey((k) => k + 1);
    } catch (e: any) { alert(e.message ?? 'Sync failed'); }
    finally { setSyncing(false); }
  }

  async function importConnections() {
    if (!confirm("Import this seat's existing LinkedIn connections into this campaign as ready-to-message leads? (Best used on a Direct Messages campaign.)")) return;
    setImportingConns(true);
    try {
      const r = await api.post<{ imported: number; creditsCharged?: number }>(`${base}/campaigns/${campaignId}/import-connections`, {});
      alert(r.imported > 0
        ? `Imported ${r.imported} connection${r.imported === 1 ? '' : 's'}.${r.creditsCharged ? ` · ${r.creditsCharged} credit${r.creditsCharged === 1 ? '' : 's'} used.` : ''} Run more anytime — the daily send cap paces outreach.`
        : 'No new connections found to import (all are already in this campaign).');
      setTab('all'); setPage(1); setReloadKey((k) => k + 1);
    } catch (e: any) { alert(e.message ?? 'Import failed'); }
    finally { setImportingConns(false); }
  }

  async function sourceFromAudience() {
    setSourcing(true);
    try {
      const r = await api.post<{ sourced: number; keywords: string; creditsCharged?: number }>(`${base}/campaigns/${campaignId}/source-leads?limit=25`, {});
      alert(r.sourced > 0
        ? `Added ${r.sourced} lead${r.sourced === 1 ? '' : 's'} from LinkedIn search (query: "${r.keywords}").${r.creditsCharged ? ` · ${r.creditsCharged} credit${r.creditsCharged === 1 ? '' : 's'} used.` : ''}`
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
    if (fStep !== '') qs.set('step', fStep);
    if (fFrom) qs.set('sentFrom', fFrom);
    if (fTo) qs.set('sentTo', fTo);
    api.get<LiLeadsPage>(`${base}/campaigns/${campaignId}/leads?${qs}`).then(setData);
  }, [campaignId, base, tab, page, dq, fStep, fFrom, fTo, reloadKey]);

  async function deleteLead(id: string, name: string) {
    if (!confirm(`Remove "${name}" from this campaign's audience? Any pending connection/message for them is cancelled.`)) return;
    try {
      await api.del(`${base}/campaigns/${campaignId}/leads/${id}`);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove lead');
    }
  }

  async function sendNow(id: string, name: string) {
    setSendingNow(id);
    try {
      const r = await api.post<{ ok: boolean; message?: string }>(`${base}/campaigns/${campaignId}/leads/${id}/send-now`, {});
      alert(r.ok
        ? `Queued the next action for ${name} to run now.\n\nIt still respects the daily cap and warm-up — if today's allowance is used up it will go tomorrow.`
        : (r.message ?? 'Nothing to send for this lead.'));
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not send now');
    } finally { setSendingNow(null); }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} target${ids.length === 1 ? '' : 's'} from this campaign's audience? Any pending connection/message for them is cancelled.`)) return;
    try {
      await api.post(`${base}/campaigns/${campaignId}/leads/delete`, { leadIds: ids });
      setSelected(new Set());
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove leads');
    }
  }

  const pageIds = data?.items.map((l) => l.id) ?? [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAllOnPage = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPageSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });

  const tabs = LEAD_TABS.map((t) => ({
    key: t.key, label: t.label,
    // Cumulative counts (Connected = connected-or-beyond, …); fall back to raw counts.
    count: t.key === 'all' ? data?.total : (data?.cumulativeCounts?.[t.status!] ?? data?.tabCounts?.[t.status!]),
  }));

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-800">Target Audience</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input className="input w-full min-w-0 sm:w-48" placeholder="Search targets…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!isPortal && selected.size > 0 && (
            <button className="btn-ghost whitespace-nowrap text-rose-600" onClick={deleteSelected} title="Remove the selected targets from this campaign">
              🗑 Delete selected ({selected.size})
            </button>
          )}
          {!isPortal && (
            <button className="btn-ghost whitespace-nowrap" disabled={syncing} onClick={syncNow} title="Refresh names + check who accepted, from LinkedIn">
              {syncing ? 'Syncing…' : '↻ Sync from LinkedIn'}
            </button>
          )}
          <button className="btn-ghost whitespace-nowrap" disabled={importingConns} onClick={importConnections} title="Import this seat's existing 1st-degree connections">
            {importingConns ? 'Importing…' : '⇲ Import connections'}
          </button>
          {!isPortal && (
            <button className="btn-primary whitespace-nowrap" disabled={sourcing} onClick={sourceFromAudience}>
              {sourcing ? 'Sourcing…' : '✦ Source from audience'}
            </button>
          )}
          <button className="btn-ghost whitespace-nowrap" onClick={() => setImporting(true)}>⭳ Import leads</button>
        </div>
      </div>
      {/* Step + sent-date filters (admin) */}
      {!isPortal && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <select className="input w-32" value={fStep} onChange={(e) => { setFStep(e.target.value); setPage(1); }} title="Filter by step reached">
            <option value="">Any step</option>
            <option value="0">Step 0 (not started)</option>
            <option value="1">Step 1</option>
            <option value="2">Step 2</option>
            <option value="3">Step 3</option>
            <option value="4">Step 4</option>
            <option value="5">Step 5</option>
          </select>
          <span className="text-slate-400">Sent between</span>
          <input type="date" className="input w-40" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setPage(1); }} />
          <span className="text-slate-400">and</span>
          <input type="date" className="input w-40" value={fTo} onChange={(e) => { setFTo(e.target.value); setPage(1); }} />
          {(fStep || fFrom || fTo) && (
            <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => { setFStep(''); setFFrom(''); setFTo(''); setPage(1); }}>✕ Clear</button>
          )}
        </div>
      )}
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
              {!isPortal && (
                <th className="w-8 p-3">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} title="Select all on this page" />
                </th>
              )}
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Profile</th>
              <th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Company</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Step</th>
              {!isPortal && <th className="p-3 font-medium">Connections</th>}
              <th className="p-3 font-medium">Last activity</th>
              {!isPortal && <th className="p-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => {
              const tc = parseLeadTitleCompany(l.title, l.company);
              return (
              <tr key={l.id} className="border-b border-slate-50">
                {!isPortal && (
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                    />
                  </td>
                )}
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
                {!isPortal && <td className="p-3 text-slate-600">{l.connectionsCount != null ? l.connectionsCount.toLocaleString() : <span className="text-slate-300" title="Hidden or not yet fetched">—</span>}</td>}
                <td className="p-3 whitespace-nowrap text-xs text-slate-500">{l.lastActionAt ? new Date(l.lastActionAt).toLocaleString() : '—'}</td>
                {!isPortal && (
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button className="whitespace-nowrap text-xs font-medium text-slate-600 hover:underline" onClick={() => setLogLead({ id: l.id, name: l.fullName })} title="See when each step was sent">
                        Log
                      </button>
                      <button
                        className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline disabled:opacity-40"
                        disabled={sendingNow === l.id}
                        onClick={() => sendNow(l.id, l.fullName)}
                        title="Run this lead's next action immediately (daily cap + warm-up still apply)"
                      >
                        {sendingNow === l.id ? '…' : '⚡ Send now'}
                      </button>
                      <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => deleteLead(l.id, l.fullName)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {data && data.items.length === 0 && <tr><td colSpan={isPortal ? 7 : 10} className="p-8 text-center text-slate-400">{dq ? 'No targets match your search.' : 'No leads in this view.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {logLead && (
        <LiLeadLogModal
          logUrl={`${base}/campaigns/${campaignId}/leads/${logLead.id}/log`}
          name={logLead.name}
          onClose={() => setLogLead(null)}
        />
      )}
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
