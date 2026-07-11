'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface Registration {
  id: string;
  source: 'login' | 'profile';
  name: string;
  email: string;
  company?: string | null;
  mobile?: string | null;
  status: string;
  emailVerified: boolean | null;
  profiles: number;
  lastLoginAt?: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;
const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INVITED: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-rose-100 text-rose-700',
};

/** Admin view of every client login (self-registration visibility / spam check). */
export default function RegisteredClientsPage() {
  const [items, setItems] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [verified, setVerified] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, status, verified]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('q', dq);
    if (status) params.set('status', status);
    if (verified) params.set('verified', verified);
    api.get<{ items: Registration[]; total: number }>(`/clients/registrations?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status, verified]);

  return (
    <div>
      <PageHeader title="Registered Clients" subtitle="Every client login that has signed up — verified or not, with or without a workspace." />

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Search name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <select className="input w-44" value={verified} onChange={(e) => setVerified(e.target.value)}>
          <option value="">All (verified & not)</option>
          <option value="true">Verified only</option>
          <option value="false">Unverified only</option>
        </select>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message="No registered clients match this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} registration{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Profiles</th>
                  <th className="px-4 py-3">Registered</th>
                  <th className="px-4 py-3">Last login</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={`${u.source}-${u.id}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{u.mobile || '—'}</td>
                    <td className="px-4 py-3">
                      {u.source === 'profile'
                        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400" title="Admin-created profile — no client login">No login</span>
                        : u.emailVerified
                          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Verified</span>
                          : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Unverified</span>}
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[u.status] ?? 'bg-slate-100 text-slate-600'}`}>{u.status}</span></td>
                    <td className="px-4 py-3">
                      {u.source === 'profile'
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700" title="Admin-created client profile">Admin-created</span>
                        : u.profiles > 0
                          ? <span className="font-semibold text-slate-700">{u.profiles} profile{u.profiles === 1 ? '' : 's'}</span>
                          : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700" title="Registered but never set up a workspace">No workspace</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
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
