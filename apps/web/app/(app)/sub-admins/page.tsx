'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface SubAdmin {
  id: string;
  name: string;
  email: string;
  status: string;
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

export default function SubAdminsPage() {
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignUser, setAssignUser] = useState('');
  const [error, setError] = useState('');

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
      await api.post(`/sub-admins/${selected}/assignments`, {
        assignedUserId: assignUser,
      });
      setAssignUser('');
      openSubAdmin(selected);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const regularUsers = users.filter((u) => u.role === 'USER');

  return (
    <div>
      <PageHeader
        title="Sub Admins"
        subtitle="Delegate review by assigning users to sub-admins"
      />
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-medium">
            Sub-admins
          </div>
          {subAdmins.length === 0 ? (
            <EmptyState message="No sub-admins. Create a user with the SUB_ADMIN role." />
          ) : (
            <ul>
              {subAdmins.map((sa) => (
                <li
                  key={sa.id}
                  onClick={() => openSubAdmin(sa.id)}
                  className={`flex cursor-pointer items-center justify-between border-t border-slate-100 px-5 py-3 text-sm hover:bg-slate-50 ${
                    selected === sa.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <div>
                    <div className="font-medium">{sa.name}</div>
                    <div className="text-xs text-slate-400">{sa.email}</div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {sa._count?.assignmentsAsSubAdmin ?? 0} assigned
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-3 font-medium">
            {selected ? 'Assignments' : 'Select a sub-admin'}
          </h3>
          {selected && (
            <>
              <div className="mb-4 flex gap-2">
                <select
                  className="input"
                  value={assignUser}
                  onChange={(e) => setAssignUser(e.target.value)}
                >
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
                <p className="text-sm text-slate-400">No assignments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {assignments.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-lg border border-slate-100 px-3 py-2 text-sm"
                    >
                      {a.assignedUser
                        ? `User · ${a.assignedUser.name}`
                        : a.campaign
                          ? `Campaign · ${a.campaign.name}`
                          : 'Assignment'}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
