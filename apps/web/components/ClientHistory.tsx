'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SubscriptionHistory } from '@/components/SubscriptionHistory';

interface ClientChange {
  at: string;
  by: string;
  action: string;
  field: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Staff view of a client's history: every subscription (with its invoice, dates and who
 * entered it), then every field change — old value → new value, who, when. Changes come
 * from the audit log, so edits made before this panel existed are included too.
 */
export function ClientHistory({ clientId, defaultOpen = false }: { clientId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [changes, setChanges] = useState<ClientChange[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || changes) return;
    api
      .get<{ items: ClientChange[] }>(`/clients/${clientId}/change-history`)
      .then((r) => setChanges(r.items))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [open, changes, clientId]);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen((o) => !o)}
      >
        <span>History — subscriptions &amp; changes</span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Subscriptions</div>
            <SubscriptionHistory clientId={clientId} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Changes</div>
            {err ? (
              <div className="text-sm text-rose-600">{err}</div>
            ) : !changes ? (
              <div className="text-sm text-slate-400">Loading…</div>
            ) : changes.length === 0 ? (
              <div className="text-sm text-slate-400">No changes recorded yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {changes.map((c, i) => (
                  <li key={`${c.at}-${c.field}-${i}`} className="py-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-slate-700">{c.label}</span>
                      {c.action === 'RENEW_CLIENT' && (
                        <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">renewal</span>
                      )}
                    </div>
                    <div className="break-words text-slate-600">
                      <span className="text-slate-400 line-through">{c.from}</span>
                      <span className="mx-1.5 text-slate-400">→</span>
                      <span>{c.to}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      by {c.by} · {new Date(c.at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
