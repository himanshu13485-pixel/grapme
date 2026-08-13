'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';
import { LiLeadLogModal } from '@/components/LiLeadLogModal';

interface ActionRow {
  id: string;
  type: 'SEND_CONNECTION' | 'SEND_MESSAGE' | 'CHECK_ACCEPTANCE' | 'COMPLETE_LEAD';
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  stepOrder: number | null;
  runAt: string;
  doneAt: string | null;
  error: string | null;
  lead: { id: string; fullName: string; status?: string; lastReplyAt?: string | null; currentStep: number; profileUrl?: string | null; connectionsCount?: number | null };
  campaign: { id: string; name: string };
  client?: { id: string; name: string; company?: string | null; invoice?: string | null } | null;
}

const PAGE_SIZE = 25;

// Friendly step/action label from the raw action type + sequence order.
function actionLabel(type: ActionRow['type'], stepOrder: number | null): string {
  if (type === 'SEND_CONNECTION') return 'Connection request';
  if (type === 'SEND_MESSAGE') return stepOrder && stepOrder >= 2 ? `Follow-up ${stepOrder - 1}` : 'Message';
  if (type === 'CHECK_ACCEPTANCE') return 'Acceptance check';
  return 'Complete';
}

const STATUS: Record<ActionRow['status'], { label: string; cls: string }> = {
  DONE: { label: 'Sent', cls: 'bg-emerald-100 text-emerald-700' },
  PENDING: { label: 'Scheduled', cls: 'bg-amber-100 text-amber-700' },
  QUEUED: { label: 'Scheduled', cls: 'bg-amber-100 text-amber-700' },
  RUNNING: { label: 'Sending…', cls: 'bg-sky-100 text-sky-700' },
  FAILED: { label: 'Failed', cls: 'bg-rose-100 text-rose-700' },
  CANCELLED: { label: 'Skipped', cls: 'bg-slate-100 text-slate-500' },
};

const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => fmtDate(new Date());
/** Shift a YYYY-MM-DD string by n days (falls back to today for an empty value). */
const addDaysStr = (s: string, n: number) => {
  const d = s ? new Date(`${s}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return s;
  d.setDate(d.getDate() + n);
  return fmtDate(d);
};

export default function LinkedInLogPage() {
  const [items, setItems] = useState<ActionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [fStep, setFStep] = useState('');
  // Default to today's activity.
  const [fFrom, setFFrom] = useState(todayStr());
  const [fTo, setFTo] = useState(todayStr());
  const [logLead, setLogLead] = useState<{ campaignId: string; id: string; name: string } | null>(null);
  const [corrupted, setCorrupted] = useState<{ count: number; byClient: { clientId: string; name: string; count: number }[] } | null>(null);

  useEffect(() => {
    api.get<{ count: number; byClient: { clientId: string; name: string; count: number }[] }>('/linkedin/overview/excluded-corrupted')
      .then(setCorrupted).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [dq, status, type, fStep, fFrom, fTo]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('client', dq);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (fStep !== '') params.set('step', fStep);
    if (fFrom) params.set('from', fFrom);
    if (fTo) params.set('to', fTo);
    api.get<{ items: ActionRow[]; total: number }>(`/linkedin/overview/actions?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status, type, fStep, fFrom, fTo]);

  const isToday = useMemo(() => fFrom === todayStr() && fTo === todayStr(), [fFrom, fTo]);

  return (
    <div>
      <PageHeader
        title="LinkedIn Log"
        subtitle="Every scheduled connection request & follow-up across all clients — step, status, planned and actual send time. Read-only (no LinkedIn calls)."
      />

      {corrupted && corrupted.count > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium">⚠ {corrupted.count} lead{corrupted.count === 1 ? '' : 's'} auto-excluded — corrupted profile link (re-import needed)</div>
          {corrupted.byClient.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-amber-700">
              {corrupted.byClient.slice(0, 12).map((c) => (
                <span key={c.clientId}>{c.name}: <strong>{c.count}</strong></span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Filter by client, company, or invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={type} onChange={(e) => setType(e.target.value)} title="Filter by step type">
          <option value="">All steps</option>
          <option value="SEND_CONNECTION">Connection request</option>
          <option value="SEND_MESSAGE">Follow-up message</option>
        </select>
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)} title="Filter by status">
          <option value="">Any status</option>
          <option value="DONE">Sent</option>
          <option value="PENDING">Scheduled</option>
          <option value="RUNNING">Sending</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Skipped</option>
        </select>
        <select className="input w-28" value={fStep} onChange={(e) => setFStep(e.target.value)} title="Filter by sequence step">
          <option value="">Any step</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Step {n}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <button
            className="grid h-9 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            onClick={() => { setFFrom((f) => addDaysStr(f, -1)); setFTo((t) => addDaysStr(t, -1)); }}
            title="Shift range one day earlier"
          >◀</button>
          <input type="date" className="input w-36" value={fFrom} onChange={(e) => setFFrom(e.target.value)} title="From (scheduled date)" />
          <span>–</span>
          <input type="date" className="input w-36" value={fTo} onChange={(e) => setFTo(e.target.value)} title="To (scheduled date)" />
          <button
            className="grid h-9 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            onClick={() => { setFFrom((f) => addDaysStr(f, 1)); setFTo((t) => addDaysStr(t, 1)); }}
            title="Shift range one day later"
          >▶</button>
          {!isToday && (
            <button className="btn-ghost text-xs" onClick={() => { setFFrom(todayStr()); setFTo(todayStr()); }} title="Back to today">Today</button>
          )}
        </div>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message={isToday ? 'No LinkedIn activity scheduled or sent for today yet.' : 'No activity for this filter.'} />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">
            {total} action{total === 1 ? '' : 's'}{isToday ? ' today' : ''}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Step</th>
                  <th className="px-4 py-3">Connections</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Scheduled</th>
                  <th className="px-4 py-3">Sent / reason</th>
                  <th className="px-4 py-3 text-right">Log</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {a.lead.profileUrl
                          ? <a href={a.lead.profileUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">{a.lead.fullName}</a>
                          : <span className="font-medium text-slate-800">{a.lead.fullName}</span>}
                        {a.lead.status === 'REPLIED' && (
                          <span
                            className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                            title={a.lead.lastReplyAt ? `Replied ${new Date(a.lead.lastReplyAt).toLocaleString()} — sequence stopped` : 'Replied — sequence stopped'}
                          >Replied</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {a.client
                        ? <Link href={`/linkedin/${a.client.id}?tab=campaigns`} className="text-slate-700 hover:underline">{a.client.name}</Link>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {a.client
                        ? <Link href={`/linkedin/${a.client.id}/campaigns/${a.campaign.id}`} className="text-slate-600 hover:underline">{a.campaign.name}</Link>
                        : <span className="text-slate-600">{a.campaign.name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-700">{actionLabel(a.type, a.stepOrder)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {a.lead.connectionsCount != null ? a.lead.connectionsCount.toLocaleString() : <span className="text-slate-300" title="Hidden or not yet fetched">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{new Date(a.runAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">
                      {a.doneAt
                        ? <span className="whitespace-nowrap text-slate-600">{new Date(a.doneAt).toLocaleString()}</span>
                        : a.error
                          ? <span className={a.status === 'CANCELLED' ? 'text-slate-500' : 'text-rose-500'} title={a.error}>{a.error}</span>
                          : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-xs font-medium text-slate-600 hover:underline" onClick={() => setLogLead({ campaignId: a.campaign.id, id: a.lead.id, name: a.lead.fullName })} title="Full timeline for this lead (incl. replies)">Log</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
      {logLead && (
        <LiLeadLogModal
          logUrl={`/linkedin/overview/leads/${logLead.campaignId}/${logLead.id}/log`}
          name={logLead.name}
          onClose={() => setLogLead(null)}
        />
      )}
    </div>
  );
}
