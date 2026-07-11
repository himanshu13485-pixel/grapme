'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination, StatusBadge } from '@/components/ui';

interface ReqRow {
  id: string;
  requestedPlan: string;
  currency?: string | null;
  period: string;
  amount: number;
  mode: string;
  status: string;
  createdAt: string;
  client?: { id: string; name: string; company?: string | null; invoice?: string | null; email?: string | null; mobile?: string | null } | null;
}
const PAGE_SIZE = 25;

export default function PlanRequestsPage() {
  const [items, setItems] = useState<ReqRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, status]);

  function load() {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('q', dq);
    if (status) params.set('status', status);
    api.get<{ items: ReqRow[]; total: number }>(`/billing/plan-requests?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }
  useEffect(load, [page, dq, status]);

  async function act(id: string, action: 'activate' | 'reject') {
    if (action === 'reject' && !confirm('Reject this plan request?')) return;
    setBusy(id + action);
    try { await api.post(`/billing/plan-requests/${id}/${action}`); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed'); }
    finally { setBusy(''); }
  }

  return (
    <div>
      <PageHeader title="Plan Upgrade Request" subtitle="Client plan requests — activate after payment (manual) or review auto payments." />

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Search company, name, email, mobile, invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="ACTIVATED">Activated</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {!loaded ? <EmptyState message="Loading…" /> : items.length === 0 ? (
        <EmptyState message="No plan requests in this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} request{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.client?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.client?.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.client?.email || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.client?.mobile || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.client?.invoice || '—'}</td>
                    <td className="px-4 py-3">{r.requestedPlan}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.amount > 0 ? `${r.currency ?? ''} ${r.amount.toLocaleString()} / ${r.period === 'yearly' ? 'yr' : 'mo'} + tax` : '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.mode === 'AUTO' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>{r.mode}</span></td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {(r.status === 'PENDING' || r.status === 'PAID') && (
                        <span className="flex justify-end gap-2">
                          <button className="btn-primary px-3 py-1 text-xs" disabled={busy !== ''} onClick={() => act(r.id, 'activate')}>Activate</button>
                          <button className="btn-ghost px-3 py-1 text-xs" disabled={busy !== ''} onClick={() => act(r.id, 'reject')}>Reject</button>
                        </span>
                      )}
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
