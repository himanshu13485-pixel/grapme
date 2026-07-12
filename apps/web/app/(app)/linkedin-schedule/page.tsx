'use client';

import { Fragment, useEffect, useState } from 'react';
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
  nextSendAt?: string | null;
  forecast?: { date: string; connections: number; messages: number; leads: number }[];
  client?: { id: string; name: string; company?: string | null; invoice?: string | null } | null;
}

const PAGE_SIZE = 25;
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const fmtDays = (d: number[]) => (!d?.length ? '—' : [...d].sort().map((x) => DAYS[x] ?? x).join(' '));
const hr = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

interface DailyTotal { date: string; connections: number; messages: number; leads: number; campaigns: number; campaignName?: string | null; }

export default function LinkedInSchedulePage() {
  const [items, setItems] = useState<ScheduleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('week');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [emBusy, setEmBusy] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [totals, setTotals] = useState<DailyTotal[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, status, range, from, to]);

  async function emergency(action: 'pause-all' | 'resume-all' | 'stop-all') {
    const verb = action === 'pause-all' ? 'pause' : action === 'resume-all' ? 'resume' : 'stop';
    if (!confirm(`${verb[0].toUpperCase() + verb.slice(1)} ALL LinkedIn campaigns across every client?`)) return;
    setEmBusy(action);
    try {
      const r = await api.post<{ affected: number }>(`/linkedin/overview/${action}`, {});
      alert(`${r.affected} campaign${r.affected === 1 ? '' : 's'} ${verb}${verb === 'stop' ? 'ped' : verb === 'resume' ? 'd' : 'd'}.`);
      setPage(1);
    } catch (e: any) { alert(e?.message ?? 'Failed'); }
    finally { setEmBusy(''); }
  }

  useEffect(() => {
    if (range === 'custom' && (!from || !to)) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), range });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    if (range === 'custom') { params.set('from', from); params.set('to', to); }
    api.get<{ items: ScheduleRow[]; total: number; dailyTotals?: DailyTotal[] }>(`/linkedin/overview/schedule?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); setTotals(r.dailyTotals ?? []); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status, range, from, to]);

  const RANGES: [string, string][] = [['today', 'Today'], ['week', 'Next 7 days'], ['upcoming', 'All upcoming'], ['all', 'All'], ['custom', 'Custom']];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="LinkedIn Campaigns Schedule" subtitle="Every client's LinkedIn campaigns and their next scheduled send." />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            {RANGES.map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)}
                className={`rounded-md px-3 py-1 font-medium transition ${range === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                {l}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <span className="flex items-center gap-1 text-sm">
              <input type="date" className="input py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-slate-400">→</span>
              <input type="date" className="input py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
          )}
        </div>
      </div>

      {/* Emergency controls — act on every client's LinkedIn campaigns at once. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-rose-700"><span className="text-rose-500">⬣</span> Emergency controls</div>
          <div className="text-xs text-rose-500">Act on every client&apos;s LinkedIn campaigns at once.</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 disabled:opacity-50" disabled={emBusy !== ''} onClick={() => emergency('pause-all')}>⏸ Pause all</button>
          <button className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 disabled:opacity-50" disabled={emBusy !== ''} onClick={() => emergency('resume-all')}>▶ Resume all</button>
          <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={emBusy !== ''} onClick={() => emergency('stop-all')}>⏹ Stop all</button>
        </div>
      </div>

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

      {totals.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Daily send total · all campaigns · 🔗 invites · ✉ messages · 👤 leads
          </div>
          <div className="flex flex-wrap gap-2">
            {totals.map((t) => (
              <div key={t.date} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                <div className="font-semibold text-slate-700">{new Date(`${t.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div className="mt-0.5 text-slate-600">🔗 {t.connections} · ✉ {t.messages}</div>
                <div className="max-w-[180px] truncate text-[11px] text-slate-400" title={t.campaignName ?? undefined}>
                  👤 {t.leads} leads · {t.campaignName ? t.campaignName : `${t.campaigns} campaigns`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <th className="px-4 py-3">Next send</th>
                  <th className="px-4 py-3">Send window</th>
                  <th className="px-4 py-3">Caps/day</th>
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Leads</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <Fragment key={c.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {!!c.forecast?.length && (
                          <button onClick={() => toggle(c.id)} className="text-slate-400 hover:text-slate-700" title="Show send forecast">{open.has(c.id) ? '▾' : '▸'}</button>
                        )}
                        <Link href={`/linkedin/${c.clientId}/campaigns/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.client
                        ? <Link href={`/linkedin/${c.clientId}?tab=campaigns`} className="text-slate-700 hover:underline">{c.client.name}</Link>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.client?.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.client?.invoice || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.seat || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.nextSendAt
                        ? <span className="font-medium text-slate-700">{new Date(c.nextSendAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
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
                  {open.has(c.id) && !!c.forecast?.length && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Send forecast · next {c.forecast!.length} active day{c.forecast!.length === 1 ? '' : 's'} · 🔗 invites · ✉ messages · 👤 leads
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {c.forecast!.map((f) => (
                            <div key={f.date} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                              <div className="font-medium text-slate-700">{new Date(`${f.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                              <div className="mt-0.5 text-slate-500">🔗 {f.connections} · ✉ {f.messages} · 👤 {f.leads}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
