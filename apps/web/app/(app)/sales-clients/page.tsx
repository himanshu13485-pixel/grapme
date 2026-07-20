'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Channels } from '@/components/Channels';

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
interface ClientDetail extends Client {
  invoiceNo: string | null;
  productCategory: string | null;
  serviceType: string | null;
  validityStartAt: string | null;
  createdAt: string;
}

export default function SalesClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get<Client[]>('/sales/my/clients').then(setClients).finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter(
    (c) => !q || `${c.name} ${c.contactPerson ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Clients</h1>
          <p className="text-sm text-slate-500">Read-only view of the clients assigned to you.</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Channels</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No clients found.</td></tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/sales-clients/${c.id}`)}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.contactPerson || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email || '—'}</td>
                  <td className="px-4 py-3"><Channels email={c.emailEnabled} linkedIn={c.linkedInEnabled} /></td>
                  <td className="px-4 py-3 text-slate-600">{c.plan}</td>
                  <td className="px-4 py-3 text-slate-600">{c.status}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs font-medium text-brand-700">View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
