'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';
import { ClientRow } from '@/lib/linkedin';

const PAGE_SIZE = 20;

export default function LinkedInHomePage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), linkedInEnabled: 'true' });
    if (dq) params.set('q', dq);
    api
      .get<{ items: ClientRow[]; total: number }>(`/clients/paged?${params.toString()}`)
      .then((r) => { setClients(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq]);

  return (
    <div>
      <PageHeader
        title="LinkedIn Outreach"
        subtitle="Manage each client's LinkedIn subscription, accounts, campaigns, and inbox."
      />

      <div className="mb-4">
        <input
          className="input max-w-sm"
          placeholder="Search clients…"
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
        />
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : clients.length === 0 ? (
        <EmptyState message="No clients found." />
      ) : (
        <div className="card divide-y divide-slate-100">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/linkedin/${c.id}`}
              className="flex items-center justify-between p-4 transition hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-slate-800">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.plan ?? 'No plan'} · {c.status}</div>
                </div>
              </div>
              <span className="text-sm font-medium text-brand-700">Manage LinkedIn →</span>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </div>
  );
}
