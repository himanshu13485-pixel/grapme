'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Suppression {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
}

export default function CompliancePage() {
  const [items, setItems] = useState<Suppression[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

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
        Suppressed addresses are excluded from every campaign at send time.
        Unsubscribes and bounces land here automatically.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Suppression list is empty." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{s.email}</td>
                  <td className="px-5 py-3 text-slate-500">{s.reason}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
