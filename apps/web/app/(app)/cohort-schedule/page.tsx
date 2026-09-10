'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface AgendaRow {
  clientName: string;
  cohortLabel: string;
  monthIndex: number;
  /** Server-rendered "#2B" - falls back to the plain month if absent. */
  cohortRef?: string;
  stage: string;
  estStart: string;
  estEnd: string;
  state: 'current' | 'upcoming';
}

type Range = 'today' | 'week' | 'all' | 'custom';

function dayKey(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CohortSchedulePage() {
  const [rows, setRows] = useState<AgendaRow[]>([]);
  const [range, setRange] = useState<Range>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [stageFilter, setStageFilter] = useState<'ALL' | 'INITIAL' | 'FU'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const PAGE_SIZE = 50;

  function loadAgenda() {
    api.get<AgendaRow[]>('/programs/agenda').then(setRows).catch(() => setRows([]));
  }
  useEffect(loadAgenda, []);

  async function controlAll(action: 'pause' | 'resume' | 'stop') {
    const verb =
      action === 'pause' ? 'PAUSE' : action === 'resume' ? 'RESUME' : 'STOP';
    const warn =
      action === 'stop'
        ? 'STOP ALL cohorts permanently and end their active contacts? This cannot be undone.'
        : `${verb} ALL cohorts across every client now?`;
    if (!confirm(warn)) return;
    setBusy(true);
    setNote('');
    try {
      const r = await api.post<{ action: string; affected: number }>(
        `/programs/cohorts/${action}`,
      );
      setNote(`${verb.toLowerCase()}d ${r.affected} cohort(s).`);
      loadAgenda();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const clientNames = useMemo(
    () => [...new Set(rows.map((r) => r.clientName))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    if (range === 'today') limit.setDate(limit.getDate() + 1);
    else if (range === 'week') limit.setDate(limit.getDate() + 7);
    const from = customFrom ? new Date(customFrom) : null;
    const to = customTo ? new Date(customTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const d = new Date(r.estStart);
      if (range === 'custom') {
        if (from && d < from) return false;
        if (to && d > to) return false;
      } else if (range !== 'all' && d >= limit) {
        return false;
      }
      if (clientFilter !== 'ALL' && r.clientName !== clientFilter) return false;
      if (stageFilter === 'INITIAL' && r.stage !== 'Initial') return false;
      if (stageFilter === 'FU' && r.stage === 'Initial') return false;
      if (q && ![r.clientName, r.cohortLabel, r.stage].some((v) => v.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [rows, range, customFrom, customTo, clientFilter, stageFilter, search]);

  // Paginate the flat (date-sorted) list, then group the current page by day.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => +new Date(a.estStart) - +new Date(b.estStart)),
    [filtered],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [range, customFrom, customTo, clientFilter, stageFilter, search]);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: AgendaRow[] }>();
    for (const r of paged) {
      const d = new Date(r.estStart);
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, { date: d, items: [] });
      map.get(k)!.items.push(r);
    }
    return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [paged]);

  const today = new Date();

  return (
    <div>
      <PageHeader
        title="Cohort Schedule"
        subtitle="Daily send line-up across all clients' running cohorts"
        action={
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {(['today', 'week', 'all', 'custom'] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-sm ${range === r ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {r === 'today' ? 'Today' : r === 'week' ? 'Next 7 days' : r === 'all' ? 'All upcoming' : 'Custom'}
              </button>
            ))}
          </div>
        }
      />

      {/* Emergency master controls — pause/resume/stop every cohort at once. */}
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-rose-200 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
            <span className="text-lg">🛑</span> Emergency controls
          </div>
          <div className="text-xs text-rose-500">Act on every client&apos;s cohorts at once.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {note && (
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              {note}
            </span>
          )}
          <button
            disabled={busy}
            onClick={() => controlAll('pause')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-sm font-semibold text-amber-700 shadow-sm transition hover:bg-amber-50 hover:shadow disabled:opacity-50"
          >
            ⏸ Pause all
          </button>
          <button
            disabled={busy}
            onClick={() => controlAll('resume')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 hover:shadow disabled:opacity-50"
          >
            ▶ Resume all
          </button>
          <button
            disabled={busy}
            onClick={() => controlAll('stop')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 hover:shadow-md disabled:opacity-50"
          >
            ⏹ Stop all
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {range === 'custom' && (
          <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5">
            <span className="text-xs text-slate-500">From</span>
            <input type="date" className="input py-1" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-xs text-slate-500">To</span>
            <input type="date" className="input py-1" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        <input
          className="input max-w-xs"
          placeholder="Search client, cohort, stage…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-56"
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="ALL">All clients</option>
          {clientNames.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="input w-44"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as 'ALL' | 'INITIAL' | 'FU')}
        >
          <option value="ALL">All stages</option>
          <option value="INITIAL">Initial only</option>
          <option value="FU">Follow-ups only</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">
          {filtered.length} send{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState message="No scheduled sends in this range." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.date.toISOString()}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">{dayKey(g.date)}</h3>
                {isSameDay(g.date, today) && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Today</span>
                )}
                <span className="text-xs text-slate-400">{g.items.length} send{g.items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Client</th>
                      <th className="px-5 py-3">Cohort</th>
                      <th className="px-5 py-3">Stage</th>
                      <th className="px-5 py-3">Window ends</th>
                      <th className="px-5 py-3">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-5 py-3 font-medium text-slate-800">{r.clientName}</td>
                        <td className="px-5 py-3 text-slate-500">{r.cohortRef ?? `#${r.monthIndex}`} · {r.cohortLabel}</td>
                        <td className="px-5 py-3 text-slate-600">{r.stage}</td>
                        <td className="px-5 py-3 text-slate-400">
                          {new Date(r.estEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-5 py-3">
                          <span className={r.state === 'current' ? 'font-medium text-emerald-600' : 'text-amber-600'}>
                            {r.state === 'current' ? 'in progress' : 'upcoming'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      <p className="mt-4 text-xs text-slate-400">
        Estimated from each cohort&apos;s start date and its sequence (±jitter). Dates are the
        first day of each ~10-day send window.
      </p>
    </div>
  );
}
