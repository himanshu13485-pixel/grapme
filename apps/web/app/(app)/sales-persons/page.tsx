'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { loginAsUser } from '@/lib/impersonate';
import { useAuth } from '@/lib/auth';

interface SalesPerson {
  id: string;
  name: string;
  email: string;
  contactMobile: string | null;
  status: string;
  lastLoginAt: string | null;
  assignedCount: number;
}
interface AssignedClient {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  plan: string;
  emailEnabled: boolean;
  linkedInEnabled: boolean;
}
interface PersonDetail {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: string;
  lastLoginAt: string | null;
  clients: AssignedClient[];
}

export default function SalesPersonsPage() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const [persons, setPersons] = useState<SalesPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPersons(await api.get<SalesPerson[]>('/sales/persons'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sales Persons</h1>
          <p className="text-sm text-slate-500">
            Executives who manage a scoped set of clients and their support tickets.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow"
        >
          + Add salesperson
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Executive</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Office mobile</th>
              <th className="px-4 py-3 text-center">Clients</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : persons.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No salespersons yet.</td></tr>
            ) : (
              persons.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">{p.email}</td>
                  <td className="px-4 py-3 text-slate-600">{p.contactMobile || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      {p.assignedCount}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSuper && (
                      <button
                        onClick={() => loginAsUser(p.id, p.name || p.email, 'SALES')}
                        disabled={p.status !== 'ACTIVE'}
                        title={p.status === 'ACTIVE'
                          ? 'Open this salesperson’s own panel as they see it'
                          : 'This login is suspended'}
                        className="mr-3 text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                      >
                        &#8623; Login as
                      </button>
                    )}
                    <button onClick={() => setEditingId(p.id)} className="text-sm font-medium text-brand-700 hover:underline">
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {editingId && (
        <EditDrawer
          id={editingId}
          onClose={() => setEditingId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await api.post('/sales/persons', form);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-slate-800">New salesperson</h2>
      <p className="mb-4 text-xs text-slate-500">
        They can sign in to the admin panel immediately and will get a welcome email with a set-password link.
      </p>
      {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      <div className="space-y-3">
        <Field label="Executive name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label="Office mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
        <Field label="Registered email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">Cancel</button>
        <button
          disabled={busy || !form.name || !form.email || form.password.length < 6}
          onClick={submit}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Overlay>
  );
}

function EditDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '', status: 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const d = await api.get<PersonDetail>(`/sales/persons/${id}`);
    setDetail(d);
    setForm({ name: d.name, mobile: d.mobile ?? '', email: d.email, password: '', status: d.status });
  }, [id]);

  useEffect(() => { load().catch((e) => setErr(e instanceof ApiError ? e.message : 'Failed to load')); }, [load]);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const payload: Record<string, string> = { name: form.name, mobile: form.mobile, email: form.email, status: form.status };
      if (form.password) payload.password = form.password;
      await api.patch(`/sales/persons/${id}`, payload);
      setMsg('Saved.');
      setForm((f) => ({ ...f, password: '' }));
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save');
    } finally { setBusy(false); }
  }

  async function unassign(clientId: string) {
    await api.post(`/sales/persons/${id}/unassign/${clientId}`);
    await load();
    onChanged();
  }

  async function remove() {
    if (!confirm('Delete this salesperson? Their clients will be unassigned.')) return;
    await api.del(`/sales/persons/${id}`);
    onChanged();
    onClose();
  }

  return (
    <Overlay onClose={onClose} wide>
      {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      {!detail ? (
        <div className="py-8 text-center text-slate-400">Loading…</div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">{detail.name}</h2>
            <button onClick={remove} className="text-sm font-medium text-rose-600 hover:underline">Delete</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Executive name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Office mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
            <Field label="Registered email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="Password (blank = keep)" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {msg && <span className="text-sm text-emerald-600">{msg}</span>}
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">
            Assigned clients ({detail.clients.length})
          </h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Mobile</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.clients.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No clients assigned.</td></tr>
                ) : (
                  detail.clients.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium text-slate-700">{c.name}</td>
                      <td className="px-3 py-2 text-slate-600">{c.contactPerson || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{c.email || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{c.mobile || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{c.status}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => unassign(c.id)} className="text-xs font-medium text-rose-600 hover:underline">
                          Unassign
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Overlay>
  );
}

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl bg-white p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}
