'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Channels } from '@/components/Channels';
import { SalesActivityDashboard } from '@/components/SalesActivityDashboard';

interface Overview {
  total: number;
  emailCount: number;
  linkedInCount: number;
  expiringSoon: number;
  expired: number;
  openTickets: number;
}
interface Client {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  plan: string;
  emailEnabled: boolean;
  linkedInEnabled: boolean;
  validityEndAt: string | null;
}

export default function SalesHomePage() {
  const { user } = useAuth();
  const [ov, setOv] = useState<Overview | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeClient, setScopeClient] = useState(''); // '' = all my clients

  useEffect(() => {
    Promise.all([
      api.get<Overview>('/sales/my/overview'),
      api.get<Client[]>('/sales/my/clients'),
    ])
      .then(([o, c]) => { setOv(o); setClients(c); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-800">Welcome{user?.name ? `, ${user.name}` : ''}</h1>
      <p className="mb-6 text-sm text-slate-500">Your assigned clients and their support at a glance.</p>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="My clients" value={ov?.total} tone="brand" />
        <Stat label="Email" value={ov?.emailCount} />
        <Stat label="LinkedIn" value={ov?.linkedInCount} />
        <Stat label="Expiring soon" value={ov?.expiringSoon} tone="amber" />
        <Stat label="Expired" value={ov?.expired} tone="rose" />
        <Stat label="Open tickets" value={ov?.openTickets} tone="brand" />
      </div>

      {/* Admin-style activity dashboard — overall, or narrowed to one client */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Client activity</h2>
        <select
          className="input w-full max-w-xs"
          value={scopeClient}
          onChange={(e) => setScopeClient(e.target.value)}
          title="Show activity for all your clients, or just one"
        >
          <option value="">All my clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="mb-8">
        <SalesActivityDashboard clientId={scopeClient || undefined} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">My clients</h2>
        <Link href="/sales-clients" className="text-sm font-medium text-brand-700 hover:underline">View all →</Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Channels</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No clients assigned to you yet.</td></tr>
            ) : (
              clients.slice(0, 8).map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.contactPerson || c.email || '—'}</td>
                  <td className="px-4 py-3">
                    <Channels email={c.emailEnabled} linkedIn={c.linkedInEnabled} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.plan}</td>
                  <td className="px-4 py-3 text-slate-600">{c.status}</td>
                  <td className="px-4 py-3 text-slate-600">{c.validityEndAt ? new Date(c.validityEndAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value?: number; tone?: 'brand' | 'amber' | 'rose' }) {
  const toneCls =
    tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : tone === 'brand' ? 'text-brand-700' : 'text-slate-800';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${toneCls}`}>{value ?? '—'}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}
