'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination, StatusBadge } from '@/components/ui';
import { parseLeadTitleCompany } from '@/lib/linkedin';
import { downloadCsv } from '@/lib/csv';
import { LiLeadLogModal } from '@/components/LiLeadLogModal';

interface LeadRow {
  id: string;
  fullName: string;
  title?: string | null;
  company?: string | null;
  profileUrl?: string | null;
  status: string;
  currentStep: number;
  connectionsCount?: number | null;
  createdAt: string;
  lastActionAt?: string | null;
  campaign: { id: string; name: string; status: string };
  client?: { id: string; name: string; company?: string | null; invoice?: string | null } | null;
}

const PAGE_SIZE = 25;
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONNECTION_PENDING: 'Sent', CONNECTED: 'Connected',
  MESSAGED: 'Messaged', REPLIED: 'Replied', BOUNCED: 'Bounced', EXCLUDED: 'Excluded',
};

export default function LinkedInLeadsPage() {
  const [items, setItems] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [fStep, setFStep] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [logLead, setLogLead] = useState<{ campaignId: string; id: string; name: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const CSV_HEADERS = ['Name', 'Profile URL', 'Title', 'Company', 'Client', 'Client company', 'Invoice', 'Campaign', 'Campaign status', 'Lead status', 'Sourced'];
  const toRow = (l: LeadRow) => {
    const tc = parseLeadTitleCompany(l.title, l.company);
    return [
      l.fullName, l.profileUrl ?? '', tc.title, tc.company,
      l.client?.name ?? '', l.client?.company ?? '', l.client?.invoice ?? '',
      l.campaign.name, l.campaign.status, STATUS_LABEL[l.status] ?? l.status,
      new Date(l.createdAt).toLocaleDateString(),
    ];
  };
  async function fetchAll(): Promise<LeadRow[]> {
    const params = new URLSearchParams({ all: 'true' });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    const r = await api.get<{ items: LeadRow[] }>(`/linkedin/overview/leads?${params}`);
    return r.items;
  }
  async function download(scope: 'page' | 'all' | 'selected') {
    setMenuOpen(false);
    setExporting(true);
    try {
      let rows: LeadRow[];
      if (scope === 'page') rows = items;
      else {
        const all = await fetchAll();
        rows = scope === 'all' ? all : all.filter((l) => selected.has(l.id));
      }
      if (rows.length === 0) { alert('No leads to download for this option.'); return; }
      downloadCsv(`linkedin-leads-${new Date().toISOString().slice(0, 10)}`, CSV_HEADERS, rows.map(toRow));
    } catch (e: any) {
      alert(e?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const allPageSelected = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggleAllPage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allPageSelected) items.forEach((l) => next.delete(l.id));
    else items.forEach((l) => next.add(l.id));
    return next;
  });
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  useEffect(() => { setPage(1); }, [dq, status, fStep, fFrom, fTo]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    if (fStep !== '') params.set('step', fStep);
    if (fFrom) params.set('sentFrom', fFrom);
    if (fTo) params.set('sentTo', fTo);
    api.get<{ items: LeadRow[]; total: number }>(`/linkedin/overview/leads?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status, fStep, fFrom, fTo]);

  return (
    <div>
      <PageHeader title="LinkedIn Leads" subtitle="Every lead sourced across clients (drip, import & audience) with its campaign and client." />

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Filter by client, company, or invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="CONNECTION_PENDING">Sent</option>
          <option value="CONNECTED">Connected</option>
          <option value="MESSAGED">Messaged</option>
          <option value="REPLIED">Replied</option>
        </select>
        <select className="input w-32" value={fStep} onChange={(e) => setFStep(e.target.value)} title="Filter by step reached">
          <option value="">Any step</option>
          <option value="0">Step 0</option>
          <option value="1">Step 1</option>
          <option value="2">Step 2</option>
          <option value="3">Step 3</option>
          <option value="4">Step 4</option>
          <option value="5">Step 5</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <span>Sent</span>
          <input type="date" className="input w-36" value={fFrom} onChange={(e) => setFFrom(e.target.value)} title="Sent on / after" />
          <span>–</span>
          <input type="date" className="input w-36" value={fTo} onChange={(e) => setFTo(e.target.value)} title="Sent on / before" />
          {(fStep || fFrom || fTo) && (
            <button className="text-slate-400 hover:text-slate-600" onClick={() => { setFStep(''); setFFrom(''); setFTo(''); }} title="Clear filters">✕</button>
          )}
        </div>
        <div className="relative">
          <button className="btn-ghost whitespace-nowrap" disabled={exporting || total === 0} onClick={() => setMenuOpen((o) => !o)}>
            {exporting ? 'Exporting…' : '⭳ Download ▾'}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                <button className="block w-full px-4 py-2 text-left hover:bg-slate-50 disabled:text-slate-300" disabled={selected.size === 0} onClick={() => download('selected')}>
                  Download selected ({selected.size})
                </button>
                <button className="block w-full px-4 py-2 text-left hover:bg-slate-50" onClick={() => download('page')}>
                  Download this page ({items.length})
                </button>
                <button className="block w-full px-4 py-2 text-left hover:bg-slate-50" onClick={() => download('all')}>
                  Download all ({total})
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message="No leads match this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} lead{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3"><input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} aria-label="Select page" /></th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Profile</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Client company</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Campaign status</th>
                  <th className="px-4 py-3">Lead status</th>
                  <th className="px-4 py-3">Step</th>
                  <th className="px-4 py-3">Connections</th>
                  <th className="px-4 py-3">Last activity</th>
                  <th className="px-4 py-3 text-right">Log</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => {
                  const tc = parseLeadTitleCompany(l.title, l.company);
                  return (
                    <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label="Select lead" /></td>
                      <td className="px-4 py-3"><div className="max-w-[180px] truncate font-medium text-slate-800" title={l.fullName}>{l.fullName}</div></td>
                      <td className="px-4 py-3">
                        {l.profileUrl
                          ? <a href={l.profileUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-brand-600 hover:underline">View</a>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><div className="max-w-[220px] truncate text-slate-600" title={tc.title}>{tc.title}</div></td>
                      <td className="px-4 py-3"><div className="max-w-[160px] truncate text-slate-600" title={tc.company}>{tc.company}</div></td>
                      <td className="px-4 py-3">
                        {l.client
                          ? <Link href={`/linkedin/${l.client.id}?tab=campaigns`} className="text-slate-700 hover:underline">{l.client.name}</Link>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{l.client?.company || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{l.client?.invoice || '—'}</td>
                      <td className="px-4 py-3">
                        {l.client
                          ? <Link href={`/linkedin/${l.client.id}/campaigns/${l.campaign.id}`} className="text-brand-700 hover:underline">{l.campaign.name}</Link>
                          : <span className="text-slate-600">{l.campaign.name}</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={l.campaign.status} /></td>
                      <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[l.status] ?? l.status}</span></td>
                      <td className="px-4 py-3 text-slate-500">{l.currentStep}</td>
                      <td className="px-4 py-3 text-slate-600">{l.connectionsCount != null ? l.connectionsCount.toLocaleString() : <span className="text-slate-300" title="Hidden or not yet fetched">—</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{l.lastActionAt ? new Date(l.lastActionAt).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs font-medium text-slate-600 hover:underline" onClick={() => setLogLead({ campaignId: l.campaign.id, id: l.id, name: l.fullName })} title="See when each step was sent">Log</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          {logLead && (
            <LiLeadLogModal
              logUrl={`/linkedin/overview/leads/${logLead.campaignId}/${logLead.id}/log`}
              name={logLead.name}
              onClose={() => setLogLead(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
