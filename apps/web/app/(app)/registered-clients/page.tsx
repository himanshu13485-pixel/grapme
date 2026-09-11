'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { loginAsUser } from '@/lib/impersonate';
import { usePlans } from '@/lib/plans';
import { useAuth } from '@/lib/auth';
import { PageHeader, EmptyState, Pagination, Modal } from '@/components/ui';

interface Registration {
  id: string;
  source: 'login' | 'profile';
  name: string;
  email: string;
  company?: string | null;
  mobile?: string | null;
  status: string;
  emailVerified: boolean | null;
  profiles: number;
  lastLoginAt?: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;
const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INVITED: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-rose-100 text-rose-700',
};

/** Admin view of every client login (self-registration visibility / spam check). */
export default function RegisteredClientsPage() {
  const [items, setItems] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [verified, setVerified] = useState('');
  const [creatingFor, setCreatingFor] = useState<Registration | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';

  async function resendVerification(u: Registration) {
    if (!confirm(`Re-send the confirmation email to ${u.email}?`)) return;
    try {
      await api.post(`/auth/client/${u.id}/resend-verification`, {});
      alert(`Confirmation email sent to ${u.email}.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to send');
    }
  }

  async function del(u: Registration) {
    const msg = u.source === 'login'
      ? `Permanently delete "${u.email}"?\n\nThis deletes the client login AND all ${u.profiles} workspace${u.profiles === 1 ? '' : 's'} it owns — cohorts, campaigns, contacts and history.\n\nThis CANNOT be undone.`
      : `Permanently delete client profile "${u.name}"?\n\nThis deletes the profile and all its data.\n\nThis CANNOT be undone.`;
    if (!confirm(msg)) return;
    try {
      const r = await api.del<{ deletedClients: number }>(`/clients/registrations/${u.source}/${u.id}`);
      alert(`Deleted.${r.deletedClients ? ` ${r.deletedClients} workspace${r.deletedClients === 1 ? '' : 's'} removed.` : ''}`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, status, verified]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq) params.set('q', dq);
    if (status) params.set('status', status);
    if (verified) params.set('verified', verified);
    api.get<{ items: Registration[]; total: number }>(`/clients/registrations?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, status, verified, reloadKey]);

  return (
    <div>
      <PageHeader title="Registered Clients" subtitle="Every client login that has signed up — verified or not, with or without a workspace." />

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Search name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <select className="input w-44" value={verified} onChange={(e) => setVerified(e.target.value)}>
          <option value="">All (verified & not)</option>
          <option value="true">Verified only</option>
          <option value="false">Unverified only</option>
        </select>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState message="No registered clients match this view." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-400">{total} registration{total === 1 ? '' : 's'}</div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Profiles</th>
                  <th className="px-4 py-3">Registered</th>
                  <th className="px-4 py-3">Last login</th>
                  {isSuper && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={`${u.source}-${u.id}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{u.mobile || '—'}</td>
                    <td className="px-4 py-3">
                      {u.source === 'profile'
                        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400" title="Admin-created profile — no client login">No login</span>
                        : u.emailVerified
                          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Verified</span>
                          : (
                            <div className="flex flex-col items-start gap-1">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Unverified</span>
                              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => resendVerification(u)}>
                                Resend verification
                              </button>
                            </div>
                          )}
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[u.status] ?? 'bg-slate-100 text-slate-600'}`}>{u.status}</span></td>
                    <td className="px-4 py-3">
                      {u.source === 'profile'
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700" title="Admin-created client profile">Admin-created</span>
                        : u.profiles > 0
                          ? <span className="font-semibold text-slate-700">{u.profiles} profile{u.profiles === 1 ? '' : 's'}</span>
                          : (
                            <div className="flex flex-col items-start gap-1">
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700" title="Registered but never set up a workspace">No workspace</span>
                              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setCreatingFor(u)}>+ Create workspace</button>
                            </div>
                          )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                    {isSuper && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline"
                            onClick={() => loginAsUser(u.id, u.email, 'CLIENT')}
                            title="Open the client portal signed in as this client"
                          >
                            ↪ Login as
                          </button>
                          <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => del(u)}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      {creatingFor && (
        <CreateWorkspaceModal
          reg={creatingFor}
          onClose={() => setCreatingFor(null)}
          onCreated={() => { setCreatingFor(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function CreateWorkspaceModal({ reg, onClose, onCreated }: { reg: Registration; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const { planNames } = usePlans();
  const [name, setName] = useState(reg.company || reg.name || '');
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Default to the first available plan once loaded.
  useEffect(() => { if (!plan && planNames.length) setPlan(planNames[0]); }, [planNames, plan]);

  async function create(goToEdit: boolean) {
    if (!name.trim()) { setError('Workspace name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const c = await api.post<{ id: string }>(`/clients/for-user/${reg.id}`, { name: name.trim(), plan });
      if (goToEdit) router.push(`/clients?edit=${c.id}`);
      else onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Create client workspace" disableBackdropClose>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Set up a workspace owned by <span className="font-medium text-slate-700">{reg.email}</span>. You can configure
          channels, credits and validity afterwards in the Clients Workspace.
        </p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div>
          <label className="label">Workspace / company name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Exports" />
        </div>
        <div>
          <label className="label">Plan</label>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {planNames.length === 0 && <option value="">Growth</option>}
            {planNames.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-ghost" onClick={() => create(false)} disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          <button className="btn-primary" onClick={() => create(true)} disabled={busy}>
            {busy ? 'Creating…' : 'Create & configure →'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
