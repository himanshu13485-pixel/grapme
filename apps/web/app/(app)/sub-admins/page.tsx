'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { loginAsUser } from '@/lib/impersonate';
import { useAuth } from '@/lib/auth';
import { PageHeader, EmptyState, Pagination, Modal } from '@/components/ui';

interface SubAdmin {
  id: string;
  name: string;
  email: string;
  status: string;
  fullAccess?: boolean;
  accessModules?: string[];
  canDelete?: boolean;
  canEdit?: boolean;
  lastLoginAt?: string | null;
}

// Modules a sub-admin can be granted access to (keys match the left-menu routes).
const MODULES: { key: string; label: string }[] = [
  { key: 'clients', label: 'Clients Workspace' },
  { key: 'live-clients', label: 'Live Clients' },
  { key: 'blog', label: 'Blog' },
  { key: 'registered-clients', label: 'Registered Clients' },
  { key: 'plan-requests', label: 'Plan Upgrade Request' },
  { key: 'billing', label: 'Payment / Billing' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'cohort-schedule', label: 'Cohort Schedule' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'templates', label: 'Templates' },
  { key: 'mailbox', label: 'Inbox & Sent' },
  { key: 'mailboxes', label: 'Mailboxes' },
  { key: 'deliverability', label: 'Deliverability' },
  { key: 'linkedin', label: 'LinkedIn Outreach' },
  { key: 'linkedin-inbox', label: 'LinkedIn Inbox' },
  { key: 'linkedin-schedule', label: 'LinkedIn Campaigns Schedule' },
  { key: 'linkedin-leads', label: 'LinkedIn Leads' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'duplicate-emails', label: 'Duplicate Email' },
  { key: 'activity-logs', label: 'Activity Logs' },
];

export default function SubAdminsPage() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<SubAdmin | null>(null);
  const PAGE_SIZE = 15;
  const pagedSubAdmins = subAdmins.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function load() {
    api.get<SubAdmin[]>('/sub-admins').then(setSubAdmins).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function deleteSubAdmin(sa: SubAdmin) {
    if (!confirm(`Delete sub-admin "${sa.name}" (${sa.email})? Their login is removed.`)) return;
    try {
      await api.del(`/sub-admins/${sa.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const accessLabel = (sa: SubAdmin) =>
    sa.fullAccess
      ? 'Full access'
      : `${sa.accessModules?.length ?? 0} module${(sa.accessModules?.length ?? 0) === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        title="Sub Admins"
        subtitle="Create sub-admin logins and grant access to modules"
        action={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New sub-admin
          </button>
        }
      />
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div>
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-medium">Sub-admins</div>
          {subAdmins.length === 0 ? (
            <EmptyState message="No sub-admins yet. Create one with the button above." />
          ) : (
            <ul>
              {pagedSubAdmins.map((sa) => (
                <li
                  key={sa.id}
                  className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm hover:bg-slate-50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{sa.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          sa.fullAccess ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {accessLabel(sa)}
                      </span>
                      {sa.status !== 'ACTIVE' && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {sa.status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{sa.email}</div>
                  </div>
                  <div className="whitespace-nowrap">
                    {isSuper && (
                      <button
                        className="btn-ghost text-xs disabled:cursor-not-allowed disabled:text-slate-300"
                        disabled={sa.status !== 'ACTIVE'}
                        title={sa.status === 'ACTIVE'
                          ? 'Open the admin panel as this sub-admin sees it'
                          : 'This login is suspended'}
                        onClick={() => loginAsUser(sa.id, sa.name || sa.email, 'SUB_ADMIN')}
                      >
                        &#8623; Login as
                      </button>
                    )}
                    <button className="btn-ghost text-xs" onClick={() => setEditing(sa)}>
                      Edit
                    </button>
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => deleteSubAdmin(sa)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="px-5">
            <Pagination page={page} pageSize={PAGE_SIZE} total={subAdmins.length} onPage={setPage} />
          </div>
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New sub-admin" disableBackdropClose wide>
        <SubAdminForm
          onDone={() => {
            setShowCreate(false);
            load();
          }}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit · ${editing.name}` : 'Edit sub-admin'}
        disableBackdropClose
        wide
      >
        {editing && (
          <SubAdminForm
            existing={editing}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function SubAdminForm({ existing, onDone }: { existing?: SubAdmin; onDone: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(existing?.status ?? 'ACTIVE');
  const [fullAccess, setFullAccess] = useState(existing?.fullAccess ?? false);
  const [modules, setModules] = useState<string[]>(existing?.accessModules ?? []);
  const [canDelete, setCanDelete] = useState(existing?.canDelete ?? false);
  const [canEdit, setCanEdit] = useState(existing?.canEdit ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(key: string) {
    setModules((m) => (m.includes(key) ? m.filter((x) => x !== key) : [...m, key]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (existing) {
        await api.patch(`/sub-admins/${existing.id}`, {
          name,
          status,
          fullAccess,
          accessModules: modules,
          canDelete,
          canEdit,
          password: password || undefined,
        });
      } else {
        await api.post('/sub-admins', {
          name,
          email,
          password,
          fullAccess,
          accessModules: modules,
          canDelete,
          canEdit,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Email (login) *</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!!existing}
            required
          />
        </div>
        <div>
          <label className="label">{existing ? 'New password (optional)' : 'Password *'}</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={existing ? 'Leave blank to keep current' : 'Min 6 characters'}
            minLength={existing ? undefined : 6}
            required={!existing}
          />
        </div>
        {existing && (
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
          Full access (every section)
        </label>
        {!fullAccess && (
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Grant access to specific sections
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={modules.includes(m.key)} onChange={() => toggle(m.key)} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Dashboard is always available.</p>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
        <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
        Allow edit actions (show Edit buttons for this sub-admin)
      </label>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
        <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} />
        Allow delete actions (show Delete buttons for this sub-admin)
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : existing ? 'Save changes' : 'Create sub-admin'}
      </button>
    </form>
  );
}
