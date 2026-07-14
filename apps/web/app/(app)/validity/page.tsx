'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Tabs } from '@/components/ui';
import { validityInfo } from '@/components/Validity';
import { SubscriptionHistory } from '@/components/SubscriptionHistory';
import { clientSubState, ClientSubState } from '@/lib/subscriptions';

interface Client {
  id: string;
  name: string;
  email?: string | null;
  plan: string;
  status?: string;
  validityDays?: number | null;
  validityStartAt?: string | null;
  owner?: { email: string } | null;
}

const STATE_META: Record<ClientSubState, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
  expiring: { label: 'Expiring soon', cls: 'bg-amber-50 text-amber-700' },
  expired: { label: 'Expired', cls: 'bg-rose-50 text-rose-700' },
  none: { label: 'No plan', cls: 'bg-slate-100 text-slate-500' },
};

export default function SubscriptionManagementPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | ClientSubState>('all');
  const [error, setError] = useState('');

  function load() {
    api.get<Client[]>('/clients').then(setClients).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const withState = useMemo(
    () => clients.map((c) => ({ c, state: clientSubState(c.validityDays, c.validityStartAt) })),
    [clients],
  );
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: withState.length, active: 0, expiring: 0, expired: 0, none: 0 };
    withState.forEach(({ state }) => { m[state]++; });
    return m;
  }, [withState]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return withState
      .filter(({ state }) => filter === 'all' || state === filter)
      .filter(({ c }) => !s || [c.name, c.email, c.owner?.email, c.plan].filter(Boolean).some((v) => v!.toLowerCase().includes(s)))
      .map(({ c }) => c);
  }, [withState, filter, q]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'expiring', label: 'Expiring', count: counts.expiring },
    { key: 'expired', label: 'Expired', count: counts.expired },
    { key: 'none', label: 'No plan', count: counts.none },
  ];

  return (
    <div>
      <PageHeader
        title="Subscription Management"
        subtitle="Every client's plan, validity and status — renew/edit in the workspace, deactivate or expire, and view renewal history."
      />

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {clients.length === 0 ? (
        <EmptyState message="No clients yet." />
      ) : (
        <>
          <Tabs tabs={tabs} active={filter} onChange={(k) => setFilter(k as 'all' | ClientSubState)} />
          <div className="mb-4 flex items-center gap-3">
            <input className="input max-w-xs" placeholder="Search company / email / plan…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="ml-auto text-sm text-slate-400">{filtered.length} of {clients.length}</span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Current validity</th>
                  <th className="px-4 py-3">Manage</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => <ClientRows key={c.id} client={c} onSaved={load} />)}
                {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No clients in this view.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ClientRows({ client, onSaved }: { client: Client; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const v = validityInfo(client.validityDays, client.validityStartAt);
  const state = clientSubState(client.validityDays, client.validityStartAt);
  const m = STATE_META[state];

  const active = (client.status ?? 'active').toLowerCase() === 'active';

  async function toggleActive(next: boolean) {
    setBusy(true); setNote('');
    try { await api.patch(`/clients/${client.id}/status`, { active: next }); onSaved(); }
    catch (e) { setNote(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function forceExpire() {
    if (!confirm(`Force-expire ${client.name}'s active plan now? Outreach stops immediately until you renew.`)) return;
    setBusy(true); setNote('');
    try { await api.post(`/clients/${client.id}/subscription/expire`, {}); setNote('Expired'); onSaved(); }
    catch (e) { setNote(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3">
          <div className="font-medium text-slate-800">{client.name}</div>
          {(client.email || client.owner?.email) && <div className="text-xs text-slate-400">{client.email || client.owner?.email}</div>}
          <button className="mt-1 text-xs text-brand-600 hover:text-brand-700" onClick={() => setOpen((o) => !o)}>{open ? '▾ Hide history' : '▸ Renewal history'}</button>
        </td>
        <td className="px-4 py-3 text-slate-500">{client.plan}</td>
        <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span></td>
        <td className="px-4 py-3">
          {v.none ? <span className="text-slate-400">—</span> : (
            <span className={v.expired ? 'text-rose-600' : 'text-emerald-700'}>
              {v.days} days
              {v.expiry && <span className="block text-xs text-slate-400">{v.expired ? `expired ${v.expiry.toLocaleDateString()}` : `${v.remaining} left · ${v.expiry.toLocaleDateString()}`}</span>}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Renewal is done in the client's Edit form (plan + validity), then submitted. */}
            <Link href={`/clients?edit=${client.id}`} className="btn-primary px-3 py-1 text-xs">Renew / Edit →</Link>
            <span className={`rounded-full px-2 py-0.5 font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{active ? 'Active client' : 'Deactivated'}</span>
            {active ? (
              <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50" onClick={() => toggleActive(false)} disabled={busy}>Deactivate</button>
            ) : (
              <button type="button" className="rounded-md border border-emerald-200 px-2 py-1 text-emerald-700 hover:bg-emerald-50" onClick={() => toggleActive(true)} disabled={busy}>Activate</button>
            )}
            {!v.none && !v.expired && (
              <button type="button" className="rounded-md border border-rose-200 px-2 py-1 text-rose-600 hover:bg-rose-50" onClick={forceExpire} disabled={busy}>Expire now</button>
            )}
            {note && <span className="text-slate-400">{note}</span>}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={5} className="px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Renewal history</div>
            <div className="mt-2"><SubscriptionHistory clientId={client.id} /></div>
          </td>
        </tr>
      )}
    </>
  );
}
