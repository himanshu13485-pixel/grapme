'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface LiveClient {
  clientId: string | null;
  company: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  plan: string;
  userId: string;
  loginEmail: string;
  loginName: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  sessionCount: number;
}

/** "2 min ago" style relative time. */
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function LiveClientsPage() {
  const [rows, setRows] = useState<LiveClient[]>([]);
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api
      .get<LiveClient[]>('/admin/live-clients')
      .then((r) => { setRows(r); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // Refresh every 30s so the list stays live without a manual reload.
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const plans = useMemo(
    () => [...new Set(rows.map((r) => r.plan).filter((p) => p && p !== '—'))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => plan === 'all' || r.plan === plan)
      .filter(
        (r) =>
          !s ||
          [r.company, r.contactPerson, r.phone, r.email, r.loginEmail, r.plan, r.ip]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(s)),
      );
  }, [rows, plan, q]);

  async function logout(r: LiveClient) {
    if (
      !confirm(
        `Sign "${r.loginName || r.loginEmail}" out of all sessions?\n\nThey stay signed in for up to 15 minutes (until their current access token expires), then must log in again.`,
      )
    )
      return;
    setBusy(r.userId);
    try {
      const res = await api.post<{ revoked: number }>(`/admin/client-logins/${r.userId}/logout`, {});
      alert(`Signed out — ${res.revoked} session${res.revoked === 1 ? '' : 's'} revoked.`);
      load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to sign out');
    } finally {
      setBusy(null);
    }
  }

  // Distinct logins currently online (rows can repeat a login across profiles).
  const onlineLogins = useMemo(() => new Set(rows.map((r) => r.userId)).size, [rows]);

  return (
    <div>
      <PageHeader
        title="Live Clients"
        subtitle="Clients currently signed in to the portal. A session counts as live while it stays active; it drops off after 60 minutes of inactivity. Auto-refreshes every 30s."
      />

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {loading ? (
        <EmptyState message="Loading live clients…" />
      ) : rows.length === 0 ? (
        <EmptyState message="No clients are currently signed in." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              className="input max-w-xs"
              placeholder="Search company / name / email / IP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="input max-w-[12rem]" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="all">All plans</option>
              {plans.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <span className="ml-auto flex items-center gap-1 text-sm text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {onlineLogins} client{onlineLogins === 1 ? '' : 's'} online
            </span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">IP address</th>
                  <th className="px-4 py-3">Last active</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.userId}-${r.clientId ?? i}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">{r.company}</td>
                    <td className="px-4 py-3 text-slate-600">{r.contactPerson || r.loginName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.phone || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{r.email || r.loginEmail}</div>
                      {r.email && r.email !== r.loginEmail && (
                        <div className="text-xs text-slate-400">login: {r.loginEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.plan}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500" title={r.userAgent ?? ''}>
                      {r.ip || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <span title={new Date(r.lastSeenAt).toLocaleString()}>{ago(r.lastSeenAt)}</span>
                      {r.sessionCount > 1 && (
                        <span className="ml-1 text-xs text-slate-400">· {r.sessionCount} sessions</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {r.clientId ? (
                          <Link href={`/clients?edit=${r.clientId}`} className="btn-ghost px-2 py-1 text-xs">
                            View
                          </Link>
                        ) : (
                          <span className="px-2 py-1 text-xs text-slate-300">No profile</span>
                        )}
                        <button
                          className="btn-ghost px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                          onClick={() => logout(r)}
                          disabled={busy === r.userId}
                        >
                          {busy === r.userId ? 'Signing out…' : 'Log out'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No clients match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
