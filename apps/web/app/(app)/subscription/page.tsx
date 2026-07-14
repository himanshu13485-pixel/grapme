'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';
import { ValidityBadge } from '@/components/Validity';
import { SubscriptionHistory } from '@/components/SubscriptionHistory';

interface MyClient {
  id: string;
  name: string;
  plan?: string | null;
  validityDays?: number | null;
  validityStartAt?: string | null;
}

export default function SubscriptionPage() {
  const [clients, setClients] = useState<MyClient[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<MyClient[]>('/my/clients').then(setClients).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Subscription" subtitle="Your current plan, validity and full renewal history." />

      {err && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

      {!clients ? (
        <EmptyState message="Loading…" />
      ) : clients.length === 0 ? (
        <EmptyState message="No workspace assigned yet." />
      ) : (
        clients.map((c) => (
          <div key={c.id} className="card mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-800">{c.name}</div>
                <div className="text-sm text-slate-500">Plan: <span className="font-medium text-slate-700">{c.plan || '—'}</span></div>
              </div>
              <ValidityBadge days={c.validityDays} startAt={c.validityStartAt} />
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Subscription history</div>
              <SubscriptionHistory clientId={c.id} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
