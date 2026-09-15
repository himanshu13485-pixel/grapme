'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SubHistory, SubPeriod, subStatusMeta, fmtDate, fmtMoney, entitlementChips } from '@/lib/subscriptions';

/** Renewal-history table for one client. Works for admin (any client) and the client
 *  portal (own client) — the API scopes access by role. */
export function SubscriptionHistory({ clientId, compact }: { clientId: string; compact?: boolean }) {
  const [data, setData] = useState<SubHistory | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<SubHistory>(`/clients/${clientId}/subscription-history`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [clientId]);

  if (err) return <div className="text-sm text-rose-600">{err}</div>;
  if (!data) return <div className="text-sm text-slate-400">Loading…</div>;
  if (data.items.length === 0) return <div className="text-sm text-slate-400">No subscription history yet.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2">Days</th>
            {!compact && <th className="px-3 py-2">Invoice</th>}
            {!compact && <th className="px-3 py-2">Amount</th>}
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((p) => <Row key={p.id} p={p} compact={compact} />)}
        </tbody>
      </table>
    </div>
  );
}

function Row({ p, compact }: { p: SubPeriod; compact?: boolean }) {
  const m = subStatusMeta(p.status);
  const live = p.status === 'ACTIVE' || p.status === 'EXPIRING';
  const chips = entitlementChips(p.entitlements);
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2 font-medium text-slate-800">
        <div className="flex items-center">
          {p.plan}
          {p.current && <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">current</span>}
        </div>
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-normal text-slate-500">
            {chips.map((c) => <span key={c.label} title={c.label}>{c.icon} {c.value}</span>)}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-slate-600">{fmtDate(p.startAt)} → {fmtDate(p.endAt)}</td>
      <td className="px-3 py-2 text-slate-500">{p.validityDays}d{live ? ` · ${p.daysLeft} left` : ''}</td>
      {!compact && (
        <td className="px-3 py-2 text-slate-500">
          <div>{p.invoiceNo || '—'}</div>
          {p.invoiceDate && <div className="text-[11px] text-slate-400">dated {fmtDate(p.invoiceDate)}</div>}
          {p.recordedByName && (
            <div className="text-[11px] text-slate-400">
              by {p.recordedByName}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleString()}` : ''}
            </div>
          )}
        </td>
      )}
      {!compact && <td className="px-3 py-2 text-slate-500">{fmtMoney(p.amount, p.currency)}</td>}
      <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span></td>
    </tr>
  );
}
