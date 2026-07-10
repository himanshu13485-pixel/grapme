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
    <div className="max-w-4xl">
      <PageHeader
        title="Membership"
        subtitle="Each membership plan's entitlements — validity, credits, mailboxes/seats and campaign limits for Email and LinkedIn"
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

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);

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
  const [form, setForm] = useState({
    validityDays: plan.validityDays ?? 0,
    emailCredits: num(plan.emailCredits),
    linkedInCredits: num(plan.linkedInCredits),
    mailboxLimit: num(plan.mailboxLimit),
    seatLimit: num(plan.seatLimit),
    emailCampaignLimit: num(plan.emailCampaignLimit),
    linkedInCampaignLimit: num(plan.linkedInCampaignLimit),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: number) => setForm((f) => ({ ...f, [k]: v }));

  const dirty =
    color.toLowerCase() !== plan.color.toLowerCase() ||
    form.validityDays !== (plan.validityDays ?? 0) ||
    form.emailCredits !== num(plan.emailCredits) ||
    form.linkedInCredits !== num(plan.linkedInCredits) ||
    form.mailboxLimit !== num(plan.mailboxLimit) ||
    form.seatLimit !== num(plan.seatLimit) ||
    form.emailCampaignLimit !== num(plan.emailCampaignLimit) ||
    form.linkedInCampaignLimit !== num(plan.linkedInCampaignLimit);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/plans/${plan.id}`, {
        color,
        validityDays: form.validityDays > 0 ? form.validityDays : null,
        emailCredits: form.emailCredits,
        linkedInCredits: form.linkedInCredits,
        mailboxLimit: form.mailboxLimit,
        seatLimit: form.seatLimit,
        emailCampaignLimit: form.emailCampaignLimit,
        linkedInCampaignLimit: form.linkedInCampaignLimit,
      });
      onSaved();
    } catch {
      setColor(plan.color);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="h-8 w-8 rounded-lg border border-slate-200"
            style={{ background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 60%, black))` }}
          />
          <span className="text-base font-semibold text-slate-800">{plan.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <button type="button" className="btn-primary px-3 py-1 text-xs disabled:opacity-40" onClick={save} disabled={busy || !dirty}>
            {busy ? '…' : 'Save'}
          </button>
          <button type="button" className="text-xs text-slate-400 hover:text-rose-600" onClick={() => onDelete(plan.id, plan.name)}>
            Delete
          </button>
        </div>
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">General</div>
        <NumField label="Validity (days)" value={form.validityDays} onChange={(v) => set('validityDays', v)} hint="0 = no expiry" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">📧 Email</div>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Credits" value={form.emailCredits} onChange={(v) => set('emailCredits', v)} />
            <NumField label="Mailboxes" value={form.mailboxLimit} onChange={(v) => set('mailboxLimit', v)} />
            <NumField label="Campaigns" value={form.emailCampaignLimit} onChange={(v) => set('emailCampaignLimit', v)} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">🔗 LinkedIn</div>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Credits" value={form.linkedInCredits} onChange={(v) => set('linkedInCredits', v)} />
            <NumField label="Seats" value={form.seatLimit} onChange={(v) => set('seatLimit', v)} />
            <NumField label="Campaigns" value={form.linkedInCampaignLimit} onChange={(v) => set('linkedInCampaignLimit', v)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-slate-500">{label}</label>
      <input type="number" min={0} className="input py-1.5 text-sm" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}
