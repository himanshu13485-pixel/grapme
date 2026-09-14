'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface Log {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  occurredAt: string;
  clientName?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string | null;
  actor?: { name: string; email: string; role: string };
}

// Friendly verbs for known actions; anything else is title-cased from the slug.
const ACTION_LABEL: Record<string, string> = {
  CREATE_CLIENT: 'Created client',
  UPDATE_CLIENT: 'Updated client',
  CREATE_COHORT: 'Created cohort',
  PAUSE_COHORT: 'Paused cohort',
  RESUME_COHORT: 'Resumed cohort',
  STOP_COHORT: 'Stopped cohort',
  DELETE_COHORT: 'Deleted cohort',
  CREATE_MAILBOX: 'Added mailbox',
  UPDATE_MAILBOX: 'Updated mailbox',
  DELETE_MAILBOX: 'Deleted mailbox',
  SEND_TEST_EMAIL: 'Sent test email',
  IMPORT_CONTACTS: 'Imported contacts',
  SUBMIT_CAMPAIGN: 'Submitted campaign',
  SUBMIT_FOR_APPROVAL: 'Submitted for approval',
  ADJUST_CREDITS: 'Adjusted credits',
  ASSIGN_SUBADMIN: 'Assigned sub-admin',
  UNASSIGN_SUBADMIN: 'Unassigned sub-admin',
  GDPR_ERASE: 'Erased contact (GDPR)',
  GDPR_EXPORT: 'Exported contact (GDPR)',
  IMPERSONATE_USER: 'Logged in as another account',
  IMPERSONATE_CLIENT: 'Logged in as client',
  EXTEND_CLIENT_VALIDITY: 'Added days to validity',
  SET_CLIENT_VALIDITY: 'Set validity',
  FORCE_EXPIRE_SUBSCRIPTION: 'Force-expired plan',
  ACTIVATE_CLIENT: 'Activated client',
  DEACTIVATE_CLIENT: 'Deactivated client',
  UPDATE_CLIENT_OWNER: 'Updated client login details',
  SET_CLIENT_LOGIN: 'Set client login',
  DELETE_CLIENT_LOGIN: 'Deleted client login',
  RESET_CLIENT_DEFAULT_PASSWORD: 'Reset client password',
  REQUEST_CLIENT_LOGIN_EMAIL_CHANGE: 'Requested login email change',
  DELETE_CLIENT: 'Deleted client',
  DUPLICATE_MAILBOX: 'Duplicated mailbox',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  CREATE_SUBADMIN: 'Created sub-admin',
  UPDATE_SUBADMIN: 'Updated sub-admin',
  DELETE_SUBADMIN: 'Deleted sub-admin',
  CREATE_SALESPERSON: 'Created salesperson',
  UPDATE_SALESPERSON: 'Updated salesperson',
  DELETE_SALESPERSON: 'Deleted salesperson',
  ASSIGN_SALESPERSON: 'Assigned salesperson',
  UNASSIGN_SALESPERSON: 'Unassigned salesperson',
};

function actionLabel(a: string) {
  return (
    ACTION_LABEL[a] ??
    a
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\bli\b/g, 'LinkedIn')
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  SUB_ADMIN: 'Sub admin',
  USER: 'User',
  CLIENT: 'Client',
  SALES: 'Salesperson',
};

function roleBadgeClass(role?: string) {
  if (role === 'SUPER_ADMIN') return 'bg-violet-100 text-violet-700';
  if (role === 'SUB_ADMIN') return 'bg-sky-100 text-sky-700';
  if (role === 'CLIENT') return 'bg-emerald-100 text-emerald-700';
  if (role === 'SALES') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function isDestructive(a: string) {
  return /DELETE|STOP|ERASE|UNASSIGN|REJECT|EXPIRE|DEACTIVATE|REMOVE/.test(a);
}

/** Short human label for the affected record, from the change payload. */
function targetLabel(l: Log): string {
  const o = (l.after ?? l.before ?? {}) as Record<string, unknown>;
  const name = o.name ?? o.label ?? o.subject ?? o.email ?? o.title ?? o.client;
  if (typeof name === 'string' && name) return name;
  return l.entityId ? `${l.entityId.slice(0, 8)}…` : '—';
}

/** Field-level before→after changes for the expand panel. */
function diffRows(l: Log): { key: string; before?: unknown; after?: unknown }[] {
  const b = (l.before ?? {}) as Record<string, unknown>;
  const a = (l.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => k !== 'name' && k !== 'label',
  );
  return keys.map((k) => ({ key: k, before: b[k], after: a[k] }));
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  }
  return String(v);
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  useEffect(() => {
    api.get<Log[]>('/activity-logs').then(setLogs).catch(() => {});
  }, []);

  const actions = useMemo(
    () => [...new Set(logs.map((l) => l.action))].sort(),
    [logs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
      if (roleFilter !== 'ALL' && (l.actor?.role ?? 'SYSTEM') !== roleFilter)
        return false;
      if (!q) return true;
      return [
        actionLabel(l.action),
        l.entityType,
        targetLabel(l),
        l.actor?.name,
        l.actor?.email,
      ]
        .filter(Boolean)
        .some((v) => v!.toString().toLowerCase().includes(q));
    });
  }, [logs, search, actionFilter, roleFilter]);

  useEffect(() => setPage(1), [search, actionFilter, roleFilter]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Activity logs"
        subtitle="Append-only audit trail — who changed what, and when"
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search action, target, person…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-52"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="ALL">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{actionLabel(a)}</option>
          ))}
        </select>
        <select
          className="input w-44"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="ALL">All roles</option>
          <option value="SUPER_ADMIN">Super admin</option>
          <option value="SUB_ADMIN">Sub admin</option>
          <option value="USER">User</option>
          <option value="CLIENT">Client</option>
          <option value="SALES">Salesperson</option>
          <option value="SYSTEM">System</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">
          {filtered.length} of {logs.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No activity matches." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Target</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Who</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((l) => {
                const diffs = diffRows(l);
                const expandable = diffs.length > 0;
                return (
                  <Fragment key={l.id}>
                    <tr
                      className={`border-t border-slate-100 ${expandable ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                      onClick={() => expandable && setOpen(open === l.id ? null : l.id)}
                    >
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            isDestructive(l.action)
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {actionLabel(l.action)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {expandable && (
                          <span className="mr-1 text-slate-400">{open === l.id ? '▾' : '▸'}</span>
                        )}
                        <span className="font-medium text-slate-700">{targetLabel(l)}</span>
                        <span className="ml-2 text-xs text-slate-400">{l.entityType}</span>
                      </td>
                      <td className="px-5 py-3">
                        {l.clientName ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                            {l.clientName}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700">{l.actor?.name ?? 'System'}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleBadgeClass(l.actor?.role)}`}
                          >
                            {l.actor ? (ROLE_LABEL[l.actor.role] ?? l.actor.role) : 'System'}
                          </span>
                        </div>
                        {l.actor?.email && (
                          <div className="text-xs text-slate-400">{l.actor.email}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-400">
                        {new Date(l.occurredAt).toLocaleString()}
                      </td>
                    </tr>
                    {expandable && open === l.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="mb-2 text-xs font-medium text-slate-500">
                            What changed
                          </div>
                          <table className="text-xs">
                            <thead className="text-left uppercase text-slate-400">
                              <tr>
                                <th className="py-1 pr-8">Field</th>
                                <th className="py-1 pr-8">Before</th>
                                <th className="py-1">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diffs.map((d) => (
                                <tr key={d.key} className="border-t border-slate-200">
                                  <td className="py-1 pr-8 font-medium text-slate-700">{d.key}</td>
                                  <td className="py-1 pr-8 text-rose-600">{fmtVal(d.before)}</td>
                                  <td className="py-1 text-emerald-700">{fmtVal(d.after)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {l.actor?.email && (
                            <div className="mt-3 text-xs text-slate-400">
                              By {l.actor.email}
                              {l.ipAddress ? ` · ${l.ipAddress}` : ''}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
    </div>
  );
}
