'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, PENDING_CHANGE_EVENT } from '@/lib/api';

interface PendingItem {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  /** Approved and now waiting on the client (e.g. finish connecting LinkedIn). */
  ready?: boolean;
}

/**
 * Client-portal list of what is waiting for admin review in a workspace, so a
 * held change doesn't just seem to vanish. Refreshes whenever the API reports a
 * change was held, on window focus, and once a minute.
 */
export function PendingChanges({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get<PendingItem[]>(`/client-changes/pending?clientId=${clientId}`)
      .then(setItems)
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    load();
    window.addEventListener(PENDING_CHANGE_EVENT, load);
    window.addEventListener('focus', load);
    const timer = setInterval(load, 60_000);
    return () => {
      window.removeEventListener(PENDING_CHANGE_EVENT, load);
      window.removeEventListener('focus', load);
      clearInterval(timer);
    };
  }, [load]);

  if (items.length === 0) return null;
  const ready = items.filter((i) => i.ready).length;
  const waiting = items.length - ready;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium text-amber-800">
          {waiting > 0 && `⏳ ${waiting} change${waiting === 1 ? '' : 's'} awaiting approval`}
          {waiting > 0 && ready > 0 && ' · '}
          {ready > 0 && <span className="text-emerald-700">✓ {ready} approved, action needed</span>}
        </span>
        <span className="shrink-0 text-xs text-amber-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3">
              <span className={i.ready ? 'text-emerald-700' : 'text-slate-700'}>{i.summary}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {new Date(i.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
