'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge, Tabs, Pagination, Modal } from '@/components/ui';
import { LiCampaignDetail, LiCampaignStats, LiLeadsPage } from '@/lib/linkedin';

type ParsedLead = { fullName: string; profileUrl?: string; company?: string; title?: string };

/** Turn a LinkedIn profile URL slug into a display name (real name arrives via enrichment at send). */
function slugToName(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/i);
  if (!m) return '';
  const slug = decodeURIComponent(m[1]).replace(/-[a-z0-9]{6,}$/i, '');
  return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Parse pasted lines: a LinkedIn URL, optionally `, Name, Company, Title` in any order for the text parts. */
function parseLeads(text: string): ParsedLead[] {
  const out: ParsedLead[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
    const url = parts.find((p) => /linkedin\.com\/in\//i.test(p));
    const rest = parts.filter((p) => p !== url);
    let fullName = rest[0] || (url ? slugToName(url) : line);
    if (!fullName) fullName = line;
    out.push({ fullName, profileUrl: url, company: rest[1] || undefined, title: rest[2] || undefined });
  }
  return out;
}

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

  useEffect(() => {
    const status = LEAD_TABS.find((t) => t.key === tab)?.status;
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set('status', status);
    api.get<LiLeadsPage>(`/linkedin/campaigns/${campaignId}/leads?${qs}`).then(setData);
  }, [campaignId, tab, page, reloadKey]);

  const tabs = LEAD_TABS.map((t) => ({
    key: t.key, label: t.label,
    count: t.key === 'all' ? data?.total : data?.tabCounts?.[t.status!],
  }));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{data?.total ?? 0} lead{data?.total === 1 ? '' : 's'}</div>
        <button className="btn-primary" onClick={() => setImporting(true)}>⭳ Import leads</button>
      </div>
      {importing && (
        <ImportLeadsModal
          campaignId={campaignId}
          onClose={() => setImporting(false)}
          onImported={() => { setImporting(false); setPage(1); setTab('all'); setReloadKey((k) => k + 1); }}
        />
      )}
      <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-400">
            <tr><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Company</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Step</th></tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="p-3 font-medium text-slate-800">
                  {l.profileUrl ? <a href={l.profileUrl} target="_blank" className="hover:text-brand-700">{l.fullName}</a> : l.fullName}
                </td>
                <td className="p-3 text-slate-600">{l.title ?? '—'}</td>
                <td className="p-3 text-slate-600">{l.company ?? '—'}</td>
                <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[l.status] ?? l.status}</span></td>
                <td className="p-3 text-slate-500">{l.currentStep}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No leads in this view.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

function ImportLeadsModal({ campaignId, onClose, onImported }: { campaignId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = parseLeads(text);
  const withUrl = parsed.filter((l) => l.profileUrl).length;

  async function submit() {
    if (parsed.length === 0) { setError('Paste at least one LinkedIn profile URL.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<{ imported: number }>(`/linkedin/campaigns/${campaignId}/leads`, { leads: parsed });
      alert(`Imported ${res.imported} lead${res.imported === 1 ? '' : 's'}.`);
      onImported();
    } catch (e: any) {
      setError(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import leads" wide disableBackdropClose>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Paste one LinkedIn profile URL per line. Optionally add a name, company, and title after the URL,
          comma-separated. Names and companies are auto-enriched from LinkedIn when the campaign runs.
        </p>
        <textarea
          className="input h-56 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`https://www.linkedin.com/in/jane-doe\nhttps://www.linkedin.com/in/john-smith, John Smith, Acme Exports, Founder`}
        />
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{parsed.length} row{parsed.length === 1 ? '' : 's'} · {withUrl} with profile URL</span>
          {parsed.length > 0 && withUrl < parsed.length && (
            <span className="text-amber-600">Rows without a profile URL can&apos;t be contacted until a URL is added.</span>
          )}
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || parsed.length === 0}>
            {busy ? 'Importing…' : `Import ${parsed.length || ''} lead${parsed.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
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
