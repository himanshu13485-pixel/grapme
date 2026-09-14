'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, EmptyState, Pagination } from '@/components/ui';

interface Approval {
  id: string;
  entityType: string;
  entityId: string;
  status: string;
  createdAt: string;
  target?: string | null;
  clientName?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  submittedBy?: { name: string; email: string };
  reviewer?: { name: string; email: string } | null;
  /** Inline content under review (a template's subject + body). */
  detail?: { subject?: string; bodyHtml?: string; lines?: string[] } | null;
}

// What each approval type means, in plain language.
const TYPE_LABEL: Record<string, string> = {
  SMTP: 'New mailbox',
  IMPORT: 'Contact import',
  CAMPAIGN: 'Campaign',
  SCHEDULE: 'Campaign schedule',
  SEQUENCE: 'Follow-up sequence',
  MESSAGE_DELETE: 'Message deletion',
  CLIENT_DELETE: 'Client deletion',
  CLIENT_ACTIVATION: 'Client activation',
  LI_CAMPAIGN: 'LinkedIn campaign',
  LI_CHANNEL_REQUEST: 'LinkedIn channel request',
  CLIENT_LOGIN_EMAIL: 'Client login email change',
  TEMPLATE: 'Email template',
  COHORT: 'New cohort',
  CLIENT_CHANGE: 'Client change request',
};
function typeLabel(t: string) {
  return TYPE_LABEL[t] ?? t;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [filter, setFilter] = useState('PENDING');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Client-side search across the visible columns (type / client / what / submitter).
  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter((a) =>
        [typeLabel(a.entityType), a.clientName, a.target, a.submittedBy?.name, a.submittedBy?.email]
          .some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    : items;
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function load() {
    const params = new URLSearchParams({ status: filter });
    if (typeFilter) params.set('entityType', typeFilter);
    api
      .get<Approval[]>(`/approvals?${params}`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [filter, typeFilter]);
  useEffect(() => setPage(1), [filter, typeFilter, search]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    setError('');
    try {
      if (decision === 'reject') {
        const reason = prompt('Reason for rejection?') ?? 'Rejected';
        await api.post(`/approvals/${id}/reject`, { reason });
      } else {
        await api.post(`/approvals/${id}/approve`);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Approval center"
        subtitle="Nothing goes live until you approve it"
        action={
          <select
            className="input w-40"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <select className="input w-52" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input
          className="input max-w-sm"
          placeholder="Search client, what, or submitter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={`No ${filter.toLowerCase()} items${q || typeFilter ? ' match these filters' : ''}.`} />
      ) : (
        <>
        <div className="mb-3 text-sm text-slate-400">{filtered.length} item{filtered.length === 1 ? '' : 's'}</div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Submitted by</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reviewed by</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <Fragment key={a.id}>
                <tr
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="mr-1 text-slate-400">{open === a.id ? '▾' : '▸'}</span>
                    {typeLabel(a.entityType)}
                  </td>
                  <td className="px-4 py-3">
                    {a.clientName ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {a.clientName}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{a.target ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {a.submittedBy?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {a.status === 'PENDING' ? (
                      '—'
                    ) : (
                      <div>
                        <div>{a.reviewer?.name ?? 'system'}</div>
                        {a.reviewer?.email && (
                          <div className="text-xs text-slate-400">{a.reviewer.email}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {a.status === 'PENDING' && (
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn-primary px-3 py-1 text-xs"
                          onClick={() => decide(a.id, 'approve')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-ghost px-3 py-1 text-xs"
                          onClick={() => decide(a.id, 'reject')}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {open === a.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={8} className="px-6 py-4 text-xs text-slate-600">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
                        <div><span className="text-slate-400">Type: </span>{typeLabel(a.entityType)} ({a.entityType})</div>
                        <div><span className="text-slate-400">Client: </span>{a.clientName ?? '—'}</div>
                        <div><span className="text-slate-400">What: </span>{a.target ?? a.entityId}</div>
                        <div><span className="text-slate-400">Submitted by: </span>{a.submittedBy?.name ?? '—'}{a.submittedBy?.email ? ` · ${a.submittedBy.email}` : ''}</div>
                        <div><span className="text-slate-400">Submitted: </span>{new Date(a.createdAt).toLocaleString()}</div>
                        {a.status !== 'PENDING' && (
                          <>
                            <div><span className="text-slate-400">Reviewed by: </span>{a.reviewer?.name ?? 'system'}{a.reviewer?.email ? ` · ${a.reviewer.email}` : ''}</div>
                            <div><span className="text-slate-400">Decided: </span>{a.decidedAt ? new Date(a.decidedAt).toLocaleString() : '—'}</div>
                          </>
                        )}
                        {a.status === 'REJECTED' && (
                          <div className="col-span-full text-rose-600">
                            <span className="text-slate-400">Reason: </span>{a.decisionReason ?? '—'}
                          </div>
                        )}
                        {a.detail && (
                          <div className="col-span-full mt-2 space-y-2">
                            {a.detail.lines && a.detail.lines.length > 0 && (
                              <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                                {a.detail.lines.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            )}
                            {a.detail.subject !== undefined && (
                              <div>
                                <span className="text-slate-400">Subject: </span>
                                <span className="font-medium text-slate-700">{a.detail.subject}</span>
                              </div>
                            )}
                            {/* Rendered sandboxed: client-written HTML must never run
                                script or reach the admin's session. */}
                            {a.detail.bodyHtml !== undefined && (
                              <iframe
                                title="Template preview"
                                sandbox=""
                                srcDoc={a.detail.bodyHtml}
                                className="h-72 w-full rounded-lg border border-slate-200 bg-white"
                              />
                            )}
                          </div>
                        )}
                        <div className="col-span-full text-slate-300">Ref: {a.entityId}</div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}
