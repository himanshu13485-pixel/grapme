'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Wa { enabled: boolean; senderNumber: string; provider: string; businessName: string; note: string; apiConfigured: boolean }

const PROVIDERS = [
  ['META', 'Meta WhatsApp Cloud API'],
  ['TWILIO', 'Twilio'],
  ['GUPSHUP', 'Gupshup'],
  ['OTHER', 'Other'],
];

export default function WhatsappSettingsPage() {
  const [w, setW] = useState<Wa | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get<Wa>('/notifications/whatsapp').then(setW).catch(() => {}); }, []);

  const set = (patch: Partial<Wa>) => setW((prev) => (prev ? { ...prev, ...patch } : prev));

  async function save() {
    if (!w) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.patch<Wa>('/notifications/whatsapp', {
        enabled: w.enabled, senderNumber: w.senderNumber, provider: w.provider, businessName: w.businessName, note: w.note,
      });
      setW(r); setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
    } finally { setBusy(false); }
  }

  if (!w) return <EmptyState message="Loading…" />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="WhatsApp notifications" subtitle="Set up the WhatsApp sender for client alerts (Email & LinkedIn)." />

      <div className="card p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enable WhatsApp notifications
        </label>
        <p className="mt-1 text-xs text-slate-500">Clients&apos; WhatsApp numbers are set per client in the client form; this is the business number alerts are sent from.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Sender number (with country code)</label>
            <input className="input" value={w.senderNumber} onChange={(e) => set({ senderNumber: e.target.value })} placeholder="+91 98100 00000" />
          </div>
          <div>
            <label className="label">Provider</label>
            <select className="input" value={w.provider} onChange={(e) => set({ provider: e.target.value })}>
              {PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Business / display name</label>
            <input className="input" value={w.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="GrapMe" />
          </div>
          <div>
            <label className="label">Note (internal)</label>
            <input className="input" value={w.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. WABA account, template names…" />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="mb-2 font-semibold text-slate-800">Sending API</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${w.apiConfigured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          {w.apiConfigured
            ? <span className="text-slate-600">Credentials detected — sending can be wired.</span>
            : <span className="text-slate-600">Not configured. Add <code className="rounded bg-slate-100 px-1">WHATSAPP_TOKEN</code> and <code className="rounded bg-slate-100 px-1">WHATSAPP_PHONE_ID</code> to the API <code className="rounded bg-slate-100 px-1">.env</code> when ready.</span>}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          The number and preferences are saved now; message delivery is wired once the provider API + approved templates are set up.
        </p>
      </div>
    </div>
  );
}
