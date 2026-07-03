'use client';

import { useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { usePlans, Plan } from '@/lib/plans';
import { PageHeader } from '@/components/ui';

export default function MembershipPage() {
  const { plans, loading, reload } = usePlans();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/plans', { name: name.trim(), color });
      setName('');
      setColor('#0f766e');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, planName: string) {
    if (!confirm(`Delete membership "${planName}"?`)) return;
    try {
      await api.del(`/plans/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Membership"
        subtitle="Membership plans and their theme colour — the client portal is styled by each client's membership"
      />

      <form onSubmit={add} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="label">New membership name</label>
          <input
            className="input"
            placeholder="e.g. Starter, Pro, Elite…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Theme colour</label>
          <input
            type="color"
            className="h-10 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div className="card divide-y divide-slate-100">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No memberships yet.</div>
        ) : (
          plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={reload} onDelete={remove} />)
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        A membership can only be deleted when no client is using it. Changing a colour
        re-themes the portal for every client on that membership.
      </p>
    </div>
  );
}

function PlanRow({
  plan,
  onSaved,
  onDelete,
}: {
  plan: Plan;
  onSaved: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [color, setColor] = useState(plan.color);
  const [busy, setBusy] = useState(false);
  const dirty = color.toLowerCase() !== plan.color.toLowerCase();

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/plans/${plan.id}`, { color });
      onSaved();
    } catch {
      setColor(plan.color);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="flex items-center gap-3">
        <span
          className="h-8 w-8 rounded-lg border border-slate-200"
          style={{ background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 60%, black))` }}
        />
        <span className="font-medium text-slate-800">{plan.name}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="color"
          className="h-8 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <span className="w-16 font-mono text-xs text-slate-400">{color}</span>
        {dirty && (
          <button
            type="button"
            className="btn-primary px-3 py-1 text-xs"
            onClick={save}
            disabled={busy}
          >
            {busy ? '…' : 'Save'}
          </button>
        )}
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-rose-600"
          onClick={() => onDelete(plan.id, plan.name)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
