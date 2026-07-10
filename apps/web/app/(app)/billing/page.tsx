'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Settings { paymentMode: 'AUTO' | 'MANUAL'; cashfreeConfigured: boolean }

export default function BillingPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get<Settings>('/billing/settings').then(setS).catch(() => {}); }, []);

  async function setMode(paymentMode: 'AUTO' | 'MANUAL') {
    setBusy(true); setMsg('');
    try {
      const r = await api.patch<Settings>('/billing/settings', { paymentMode });
      setS((prev) => ({ ...(prev ?? { cashfreeConfigured: false }), ...r }));
      setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
    } finally { setBusy(false); }
  }

  if (!s) return <EmptyState message="Loading…" />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Payment / Billing" subtitle="Choose how clients pay to activate a plan." />

      <div className="card p-5">
        <h3 className="mb-1 font-semibold text-slate-800">Payment mode</h3>
        <p className="mb-4 text-sm text-slate-500">Applies to every client plan selection.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setMode('AUTO')}
            disabled={busy}
            className={`rounded-xl border p-4 text-left transition ${s.paymentMode === 'AUTO' ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
          >
            <div className="text-sm font-semibold text-slate-800">⚡ Auto pay</div>
            <div className="text-xs text-slate-500">Client pays online via Cashfree and the plan activates automatically.</div>
          </button>
          <button
            onClick={() => setMode('MANUAL')}
            disabled={busy}
            className={`rounded-xl border p-4 text-left transition ${s.paymentMode === 'MANUAL' ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
          >
            <div className="text-sm font-semibold text-slate-800">📝 Manual pay</div>
            <div className="text-xs text-slate-500">Selecting a plan raises a Plan Upgrade Request; you collect payment offline and activate it.</div>
          </button>
        </div>
        {msg && <div className="mt-3 text-sm text-emerald-600">{msg}</div>}
      </div>

      <div className="card mt-4 p-5">
        <h3 className="mb-2 font-semibold text-slate-800">Cashfree gateway</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${s.cashfreeConfigured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          {s.cashfreeConfigured
            ? <span className="text-slate-600">Configured — credentials detected in the environment.</span>
            : <span className="text-slate-600">Not configured. Set <code className="rounded bg-slate-100 px-1">CASHFREE_APP_ID</code> and <code className="rounded bg-slate-100 px-1">CASHFREE_SECRET</code> in the API <code className="rounded bg-slate-100 px-1">.env</code>, plus the webhook URL <code className="rounded bg-slate-100 px-1">/api/v1/billing/cashfree/webhook</code>.</span>}
        </div>
        {!s.cashfreeConfigured && s.paymentMode === 'AUTO' && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Auto pay is on but Cashfree isn&apos;t configured — plan selections will fall back to a Plan Upgrade Request until keys are added.
          </p>
        )}
      </div>
    </div>
  );
}
