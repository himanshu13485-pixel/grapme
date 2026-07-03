'use client';

import { useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { usePlans } from '@/lib/plans';
import { PageHeader } from '@/components/ui';

export default function PlansPage() {
  const { plans, loading, reload } = usePlans();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/plans', { name: name.trim() });
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add plan');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, planName: string) {
    if (!confirm(`Delete plan "${planName}"?`)) return;
    setError('');
    try {
      await api.del(`/plans/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Plans"
        subtitle="Plan names used in every plan picker and filter — add your own and they appear everywhere"
      />

      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="New plan name (e.g. Starter, Pro)…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Adding…' : '+ Add plan'}
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div className="card divide-y divide-slate-100">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No plans yet.</div>
        ) : (
          plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <span className="font-medium text-slate-800">{p.name}</span>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-rose-600"
                onClick={() => remove(p.id, p.name)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        A plan can only be deleted when no client is using it.
      </p>
    </div>
  );
}
