'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface Row {
  id: string;
  subject: string;
  status: string;
  sentAt: string | null;
  contact: { name: string; email: string; company?: string | null } | null;
  client?: { id: string; name: string; company?: string | null; invoice?: string | null } | null;
  source?: { type: string; name: string } | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  bounced: boolean;
  forwarded: boolean;
}

const PAGE_SIZE = 25;
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => fmtDate(new Date());
const addDaysStr = (s: string, n: number) => {
  const d = s ? new Date(`${s}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return s;
  d.setDate(d.getDate() + n);
  return fmtDate(d);
};
const weekAgoStr = () => { const d = new Date(); d.setDate(d.getDate() - 6); return fmtDate(d); };

/** ✓ time / — cell for an event column. */
function EventCell({ at }: { at: string | null }) {
  if (!at) return <span className="text-slate-300">—</span>;
  return <span className="whitespace-nowrap text-emerald-700" title={new Date(at).toLocaleString()}>✓ {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

export default function MyEmailLogPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [event, setEvent] = useState('');
  const [fFrom, setFFrom] = useState(weekAgoStr());
  const [fTo, setFTo] = useState(todayStr());

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [dq, event, fFrom, fTo]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('client', dq);
    if (event) params.set('event', event);
    if (fFrom) params.set('from', fFrom);
    if (fTo) params.set('to', fTo);
    api.get<{ items: Row[]; total: number }>(`/email/my-log?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, event, fFrom, fTo]);

  const isToday = useMemo(() => fFrom === todayStr() && fTo === todayStr(), [fFrom, fTo]);

  return (
    <div>
      <PageHeader title="Email Log" subtitle="Every email sent for your workspace — who opened, clicked, replied, bounced or forwarded. Read-only." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Filter by workspace or company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={event} onChange={(e) => setEvent(e.target.value)} title="Filter by event">
          <option value="">All emails</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="replied">Replied</option>
          <option value="bounced">Bounced</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <button className="grid h-9 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={() => { setFFrom((f) => addDaysStr(f, -1)); setFTo((t) => addDaysStr(t, -1)); }} title="Shift range one day earlier">◀</button>
          <input type="date" className="input w-36" value={fFrom} onChange={(e) => setFFrom(e.target.value)} title="Sent on / after" />
          <span>–</span>
          <input type="date" className="input w-36" value={fTo} onChange={(e) => setFTo(e.target.value)} title="Sent on / before" />
          <button className="grid h-9 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={() => { setFFrom((f) => addDaysStr(f, 1)); setFTo((t) => addDaysStr(t, 1)); }} title="Shift range one day later">▶</button>
          {!isToday && <button className="btn-ghost text-xs" onClick={() => { setFFrom(todayStr()); setFTo(todayStr()); }} title="Back to today">Today</button>}
        </div>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message="No emails match this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} email{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Clicked</th>
                  <th className="px-4 py-3">Replied</th>
                  <th className="px-4 py-3">Flags</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="max-w-[180px] truncate font-medium text-slate-800" title={m.contact?.name}>{m.contact?.name ?? '—'}</div>
                      <div className="max-w-[180px] truncate text-xs text-slate-400" title={m.contact?.email}>{m.contact?.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {m.client ? <span className="text-slate-700">{m.client.name}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {m.source
                        ? <span className="text-slate-600"><span className="text-xs text-slate-400">{m.source.type}·</span> <span className="max-w-[140px] truncate align-middle">{m.source.name}</span></span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3"><div className="max-w-[220px] truncate text-slate-600" title={m.subject}>{m.subject}</div></td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{m.sentAt ? new Date(m.sentAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-xs"><EventCell at={m.openedAt} /></td>
                    <td className="px-4 py-3 text-xs"><EventCell at={m.clickedAt} /></td>
                    <td className="px-4 py-3 text-xs"><EventCell at={m.repliedAt} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {m.bounced && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">Bounced</span>}
                        {m.forwarded && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700" title="Opened from 2+ locations — likely forwarded">Forwarded</span>}
                        {!m.bounced && !m.forwarded && <span className="text-slate-300">—</span>}
                      </div>
                    </td>
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
