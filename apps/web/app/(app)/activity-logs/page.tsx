'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Log {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  occurredAt: string;
  actor?: { name: string; email: string };
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    api.get<Log[]>('/activity-logs').then(setLogs).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title="Activity logs"
        subtitle="Append-only audit trail of every action"
      />
      {logs.length === 0 ? (
        <EmptyState message="No activity recorded yet." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Entity</th>
                <th className="px-5 py-3">Actor</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-5 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                      {l.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{l.entityType}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {l.actor?.name ?? 'system'}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(l.occurredAt).toLocaleString()}
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
