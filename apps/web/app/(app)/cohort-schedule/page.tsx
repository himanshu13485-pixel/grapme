'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface AgendaRow {
  clientName: string;
  cohortLabel: string;
  monthIndex: number;
  stage: string;
  estStart: string;
  estEnd: string;
  state: 'current' | 'upcoming';
}

type Range = 'today' | 'week' | 'all';

function dayKey(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CohortSchedulePage() {
  const [rows, setRows] = useState<AgendaRow[]>([]);
  const [range, setRange] = useState<Range>('week');

  useEffect(() => {
    api.get<AgendaRow[]>('/programs/agenda').then(setRows).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    if (range === 'today') limit.setDate(limit.getDate() + 1);
    else if (range === 'week') limit.setDate(limit.getDate() + 7);
    return rows.filter((r) => {
      const d = new Date(r.estStart);
      if (range === 'all') return true;
      return d < limit;
    });
  }, [rows, range]);

  // Group by day for a clean "line-up for the day" view.
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: AgendaRow[] }>();
    for (const r of filtered) {
      const d = new Date(r.estStart);
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, { date: d, items: [] });
      map.get(k)!.items.push(r);
    }
    return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [filtered]);

  const today = new Date();

  return (
    <div>
      <PageHeader
        title="Cohort Schedule"
        subtitle="Daily send line-up across all clients' running cohorts"
        action={
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {(['today', 'week', 'all'] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-sm ${range === r ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {r === 'today' ? 'Today' : r === 'week' ? 'Next 7 days' : 'All upcoming'}
              </button>
            ))}
          </div>
        }
      />

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
                        <td className="px-5 py-3 text-slate-500">#{r.monthIndex} · {r.cohortLabel}</td>
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

      <p className="mt-4 text-xs text-slate-400">
        Estimated from each cohort&apos;s start date and its sequence (±jitter). Dates are the
        first day of each ~10-day send window.
      </p>
    </div>
  );
}
