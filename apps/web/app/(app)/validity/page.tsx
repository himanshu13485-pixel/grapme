'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';
import { validityInfo } from '@/components/Validity';

interface Client {
  id: string;
  name: string;
  email?: string | null;
  plan: string;
  validityDays?: number | null;
  validityStartAt?: string | null;
  owner?: { email: string } | null;
}

const PRESETS = [30, 180, 360];

export default function ValidityPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.get<Client[]>('/clients').then(setClients).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) =>
      [c.name, c.email, c.owner?.email, c.plan]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(s)),
    );
  }, [clients, q]);

  return (
    <div>
      <PageHeader
        title="Plan Validity"
        subtitle="Set each client's plan validity window in days (e.g. 30 / 180 / 360)"
      />

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      {clients.length === 0 ? (
        <EmptyState message="No clients yet." />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <input
              className="input max-w-xs"
              placeholder="Search by company / email / plan…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="ml-auto text-sm text-slate-400">
              {filtered.length} of {clients.length}
            </span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Current validity</th>
                  <th className="px-4 py-3">Set validity (days)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <ValidityRow key={c.id} client={c} onSaved={load} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ValidityRow({ client, onSaved }: { client: Client; onSaved: () => void }) {
  const [days, setDays] = useState<string>(
    client.validityDays ? String(client.validityDays) : '',
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const v = validityInfo(client.validityDays, client.validityStartAt);

  async function save(value: number | null) {
    setBusy(true);
    setNote('');
    try {
      await api.patch(`/clients/${client.id}/validity`, { days: value });
      setNote('Saved');
      onSaved();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-800">{client.name}</div>
        {(client.email || client.owner?.email) && (
          <div className="text-xs text-slate-400">{client.email || client.owner?.email}</div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-500">{client.plan}</td>
      <td className="px-4 py-3">
        {v.none ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className={v.expired ? 'text-rose-600' : 'text-emerald-700'}>
            {v.days} days
            {v.expiry && (
              <span className="block text-xs text-slate-400">
                {v.expired
                  ? `expired ${v.expiry.toLocaleDateString()}`
                  : `${v.remaining} left · ${v.expiry.toLocaleDateString()}`}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => {
                setDays(String(p));
                save(p);
              }}
              disabled={busy}
            >
              {p}
            </button>
          ))}
          <input
            type="number"
            min={0}
            className="input w-24 py-1 text-sm"
            placeholder="Days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary px-3 py-1 text-xs"
            onClick={() => save(days ? Number(days) : null)}
            disabled={busy}
          >
            {busy ? '…' : 'Save'}
          </button>
          {days && (
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-rose-600"
              onClick={() => {
                setDays('');
                save(null);
              }}
              disabled={busy}
            >
              Clear
            </button>
          )}
          {note && <span className="text-xs text-slate-400">{note}</span>}
        </div>
      </td>
    </tr>
  );
}
