'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface Suppression {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
  clientName?: string | null;
  lists?: string[];
}

export default function CompliancePage() {
  const [items, setItems] = useState<Suppression[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const paged = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function load() {
    api.get<Suppression[]>('/suppression').then(setItems).catch(() => {});
  }
  useEffect(load, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/suppression', { email, reason: 'MANUAL' });
      setEmail('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Compliance"
        subtitle="GDPR / CAN-SPAM suppression & opt-out list"
      />

      <form onSubmit={add} className="card mb-6 flex items-end gap-3 p-5">
        <div className="flex-1">
          <label className="label">Suppress an email address</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optout@example.com"
            required
          />
        </div>
        <button className="btn-primary">Add to suppression list</button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <p className="mb-3 text-sm text-slate-500">
        Suppressed addresses are excluded from every campaign <strong>and cohort</strong>{' '}
        at send time. Unsubscribes and bounced deliveries land here automatically
        (bounces are detected from delivery-failure replies in your mailboxes).
      </p>

      {items.length === 0 ? (
        <EmptyState message="Suppression list is empty." />
      ) : (
        <>
        <div className="mb-3 text-sm text-slate-400">{items.length} suppressed address{items.length === 1 ? '' : 'es'}</div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">List(s)</th>
                <th className="px-5 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{s.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.reason === 'BOUNCE'
                          ? 'bg-rose-100 text-rose-700'
                          : s.reason === 'UNSUBSCRIBE'
                            ? 'bg-amber-100 text-amber-700'
                            : s.reason === 'COMPLAINT'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {s.reason}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {s.clientName ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {s.clientName}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {s.lists && s.lists.length > 0 ? s.lists.join(', ') : '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}
