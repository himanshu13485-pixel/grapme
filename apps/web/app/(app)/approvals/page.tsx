'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, EmptyState } from '@/components/ui';

interface Approval {
  id: string;
  entityType: string;
  entityId: string;
  status: string;
  createdAt: string;
  submittedBy?: { name: string; email: string };
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [filter, setFilter] = useState('PENDING');
  const [error, setError] = useState('');

  function load() {
    api
      .get<Approval[]>(`/approvals?status=${filter}`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [filter]);

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

      {items.length === 0 ? (
        <EmptyState message={`No ${filter.toLowerCase()} items.`} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Submitted by</th>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{a.entityType}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {a.submittedBy?.name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
