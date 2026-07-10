'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination, StatusBadge } from '@/components/ui';
import { parseLeadTitleCompany } from '@/lib/linkedin';
import { downloadCsv } from '@/lib/csv';

interface LeadRow {
  id: string;
  fullName: string;
  title?: string | null;
  company?: string | null;
  profileUrl?: string | null;
  status: string;
  currentStep: number;
  createdAt: string;
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
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ all: 'true' });
      if (dq) params.set('client', dq);
      if (status) params.set('status', status);
      const r = await api.get<{ items: LeadRow[] }>(`/linkedin/overview/leads?${params}`);
      const rows = r.items.map((l) => {
        const tc = parseLeadTitleCompany(l.title, l.company);
        return [
          l.fullName, l.profileUrl ?? '', tc.title, tc.company,
          l.client?.name ?? '', l.client?.company ?? '', l.client?.invoice ?? '',
          l.campaign.name, l.campaign.status, STATUS_LABEL[l.status] ?? l.status,
          new Date(l.createdAt).toLocaleDateString(),
        ];
      });
      downloadCsv(
        `linkedin-leads-${new Date().toISOString().slice(0, 10)}`,
        ['Name', 'Profile URL', 'Title', 'Company', 'Client', 'Client company', 'Invoice', 'Campaign', 'Campaign status', 'Lead status', 'Sourced'],
        rows,
      );
    } catch (e: any) {
      alert(e?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => { setPage(1); }, [dq, status]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    api.get<{ items: LeadRow[]; total: number }>(`/linkedin/overview/leads?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status]);

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
        <button className="btn-ghost whitespace-nowrap" disabled={exporting || total === 0} onClick={exportCsv}>
          {exporting ? 'Exporting…' : '⭳ Export CSV'}
        </button>
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
                </tr>
              </thead>
              <tbody>
                {items.map((l) => {
                  const tc = parseLeadTitleCompany(l.title, l.company);
                  return (
                    <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
