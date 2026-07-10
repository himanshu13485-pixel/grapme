'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination, StatusBadge } from '@/components/ui';

interface ScheduleRow {
  id: string;
  name: string;
  status: string;
  clientId: string;
  timezone: string;
  run247: boolean;
  workStartHour: number;
  workEndHour: number;
  workDays: number[];
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  warmupEnabled: boolean;
  dripEnabled: boolean;
  seat?: string | null;
  leads: number;
  client?: { id: string; name: string; company?: string | null; invoice?: string | null } | null;
}

const PAGE_SIZE = 25;
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const fmtDays = (d: number[]) => (!d?.length ? '—' : [...d].sort().map((x) => DAYS[x] ?? x).join(' '));
const hr = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

export default function LinkedInSchedulePage() {
  const [items, setItems] = useState<ScheduleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, status]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    api.get<{ items: ScheduleRow[]; total: number }>(`/linkedin/overview/schedule?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status]);

  return (
    <div>
      <PageHeader title="LinkedIn Campaigns Schedule" subtitle="Every client's LinkedIn campaigns and their send schedule in one board." />

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Filter by client, company, or invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="PAUSED">Paused</option>
          <option value="DRAFT">Draft</option>
          <option value="COMPLETED">Completed</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message="No campaigns match this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} campaign{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Seat</th>
                  <th className="px-4 py-3">Send window</th>
                  <th className="px-4 py-3">Caps/day</th>
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Leads</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/linkedin/${c.clientId}/campaigns/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3">
                      {c.client
                        ? <Link href={`/linkedin/${c.clientId}?tab=campaigns`} className="text-slate-700 hover:underline">{c.client.name}</Link>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.client?.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.client?.invoice || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.seat || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {c.run247 ? '24/7' : `${hr(c.workStartHour)}–${hr(c.workEndHour)}`}
                      <div className="text-[11px] text-slate-400">{fmtDays(c.workDays)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">🔗 {c.dailyConnectionLimit} · ✉ {c.dailyMessageLimit}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex gap-1">
                        {c.warmupEnabled && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">Warm-up</span>}
                        {c.dripEnabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">Drip</span>}
                        {!c.warmupEnabled && !c.dripEnabled && <span className="text-slate-300">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{c.leads}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
