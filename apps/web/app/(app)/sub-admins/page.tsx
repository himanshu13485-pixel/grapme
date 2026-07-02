'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination, Modal } from '@/components/ui';

interface SubAdmin {
  id: string;
  name: string;
  email: string;
  status: string;
  fullAccess?: boolean;
  accessModules?: string[];
  lastLoginAt?: string | null;
  _count?: { assignmentsAsSubAdmin: number };
}
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface Assignment {
  id: string;
  assignedUser?: { name: string; email: string };
  campaign?: { name: string };
}

// Modules a sub-admin can be granted access to (keys match the left-menu routes).
const MODULES: { key: string; label: string }[] = [
  { key: 'clients', label: 'Clients Workspace' },
  { key: 'cohort-schedule', label: 'Cohort Schedule' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'templates', label: 'Templates' },
  { key: 'mailbox', label: 'Inbox & Sent' },
  { key: 'mailboxes', label: 'Mailboxes' },
  { key: 'deliverability', label: 'Deliverability' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'activity-logs', label: 'Activity Logs' },
];

export default function SubAdminsPage() {
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignUser, setAssignUser] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<SubAdmin | null>(null);
  const PAGE_SIZE = 15;
  const pagedSubAdmins = subAdmins.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function load() {
    api.get<SubAdmin[]>('/sub-admins').then(setSubAdmins).catch((e) => setError(e.message));
    api.get<User[]>('/users').then(setUsers).catch(() => {});
  }
  useEffect(load, []);

  function openSubAdmin(id: string) {
    setSelected(id);
    api.get<Assignment[]>(`/sub-admins/${id}/assignments`).then(setAssignments).catch(() => {});
  }

  async function assign() {
    if (!selected || !assignUser) return;
    try {
      await api.post(`/sub-admins/${selected}/assignments`, { assignedUserId: assignUser });
      setAssignUser('');
      openSubAdmin(selected);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function unassign(assignmentId: string) {
    try {
      await api.del(`/sub-admins/assignments/${assignmentId}`);
      if (selected) openSubAdmin(selected);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function deleteSubAdmin(sa: SubAdmin) {
    if (!confirm(`Delete sub-admin "${sa.name}" (${sa.email})? Their login and assignments are removed.`)) return;
    try {
      await api.del(`/sub-admins/${sa.id}`);
      if (selected === sa.id) setSelected(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const regularUsers = users.filter((u) => u.role === 'USER');
  const accessLabel = (sa: SubAdmin) =>
    sa.fullAccess
      ? 'Full access'
      : `${sa.accessModules?.length ?? 0} module${(sa.accessModules?.length ?? 0) === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        title="Sub Admins"
        subtitle="Create sub-admin logins, grant access, and delegate users"
        action={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New sub-admin
          </button>
        }
      />
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-medium">Sub-admins</div>
          {subAdmins.length === 0 ? (
            <EmptyState message="No sub-admins yet. Create one with the button above." />
          ) : (
            <ul>
              {pagedSubAdmins.map((sa) => (
                <li
                  key={sa.id}
                  className={`flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm hover:bg-slate-50 ${
                    selected === sa.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <div className="cursor-pointer" onClick={() => openSubAdmin(sa.id)}>
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
                    <div className="text-xs text-slate-400">
                      {sa.email} · {sa._count?.assignmentsAsSubAdmin ?? 0} user(s)
                    </div>
                  </div>
                  <div className="whitespace-nowrap">
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

        <div className="card p-5">
          <h3 className="mb-3 font-medium">
            {selected ? 'Assigned users' : 'Select a sub-admin to manage its users'}
          </h3>
          {selected && (
            <>
              <div className="mb-4 flex gap-2">
                <select className="input" value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
                  <option value="">Assign a user…</option>
                  {regularUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
                <button className="btn-primary" onClick={assign}>
                  Assign
                </button>
              </div>
              {assignments.length === 0 ? (
                <p className="text-sm text-slate-400">No users assigned yet.</p>
              ) : (
                <ul className="space-y-2">
                  {assignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                    >
                      <span>
                        {a.assignedUser
                          ? `${a.assignedUser.name} · ${a.assignedUser.email}`
                          : a.campaign
                            ? `Campaign · ${a.campaign.name}`
                            : 'Assignment'}
                      </span>
                      <button className="text-xs text-rose-500 hover:underline" onClick={() => unassign(a.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
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
          password: password || undefined,
        });
      } else {
        await api.post('/sub-admins', {
          name,
          email,
          password,
          fullAccess,
          accessModules: modules,
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

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : existing ? 'Save changes' : 'Create sub-admin'}
      </button>
    </form>
  );
}
