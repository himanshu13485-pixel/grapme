'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Client {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  plan: string;
  invoiceNo: string | null;
  emailEnabled: boolean;
  linkedInEnabled: boolean;
  validityEndAt: string | null;
  dailyBatchSize: number;
  followUpCount: number;
  monthlyQuota: number;
  stats?: {
    emailSent: number; emailOpens: number; contacts: number;
    liInvites: number; liConnected: number; liLeads: number;
  };
}

function channelLabel(c: Client): string {
  if (c.linkedInEnabled && c.emailEnabled !== false) return '📧 Email + 🔗 LinkedIn';
  if (c.linkedInEnabled) return '🔗 LinkedIn only';
  return '📧 Email only';
}

export default function SalesClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get<Client[]>('/sales/my/clients').then(setClients).finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter(
    (c) => !q || `${c.name} ${c.contactPerson ?? ''} ${c.email ?? ''} ${c.plan}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Clients</h1>
          <p className="text-sm text-slate-500">
            Read-only view of the clients assigned to you — open one to see its campaigns, leads and contacts.
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients…"
          className="input w-full max-w-xs"
        />
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          {q ? 'No clients match your search.' : 'No clients assigned to you yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const expired = c.validityEndAt && new Date(c.validityEndAt) < new Date();
            const active = (c.status ?? 'active').toLowerCase() === 'active';
            return (
              <Link key={c.id} href={`/sales-clients/${c.id}`} className="card p-5 transition hover:border-brand-300 hover:shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800">{c.name}</div>
                  <div className="flex items-center gap-1.5">
                    {expired && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Expired</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                </div>
                {(c.email || c.contactPerson) && (
                  <div className="mt-0.5 truncate text-xs text-slate-500">{c.email || c.contactPerson}</div>
                )}
                <div className="mt-1 text-xs text-slate-400">
                  {c.plan}
                  {c.invoiceNo && <span> · Invoice {c.invoiceNo}</span>}
                </div>
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                    {channelLabel(c)}
                  </span>
                </div>

                {c.emailEnabled !== false && (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Sent" value={c.stats?.emailSent ?? 0} />
                    <Stat label="Opens" value={c.stats?.emailOpens ?? 0} />
                    <Stat label="Contacts" value={c.stats?.contacts ?? 0} />
                  </div>
                )}
                {c.linkedInEnabled && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Invites" value={c.stats?.liInvites ?? 0} />
                    <Stat label="Connected" value={c.stats?.liConnected ?? 0} />
                    <Stat label="Leads" value={c.stats?.liLeads ?? 0} />
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>{c.dailyBatchSize}/day · {c.followUpCount} follow-ups · {c.monthlyQuota}/mo</span>
                  <span className="font-medium text-brand-600">View →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-base font-bold text-slate-800">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
