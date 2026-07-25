'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface LogEntry {
  label: string;
  status: 'DONE' | 'PENDING' | 'QUEUED' | 'RUNNING' | 'FAILED' | 'CANCELLED';
  at: string;
  scheduledFor: string;
  error: string | null;
}
interface LogResponse {
  lead: { id: string; fullName: string; status: string; currentStep: number };
  entries: LogEntry[];
}

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  DONE: { label: 'Sent', cls: 'text-emerald-700', dot: 'bg-emerald-500' },
  PENDING: { label: 'Scheduled', cls: 'text-amber-700', dot: 'bg-amber-400' },
  QUEUED: { label: 'Scheduled', cls: 'text-amber-700', dot: 'bg-amber-400' },
  RUNNING: { label: 'Sending…', cls: 'text-sky-700', dot: 'bg-sky-500' },
  FAILED: { label: 'Failed', cls: 'text-rose-700', dot: 'bg-rose-500' },
  CANCELLED: { label: 'Cancelled', cls: 'text-slate-500', dot: 'bg-slate-400' },
};

/** Timeline of a lead's steps — when the connection request + each follow-up was sent. */
export function LiLeadLogModal({ logUrl, name, onClose }: { logUrl: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<LogResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<LogResponse>(logUrl).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the log'));
  }, [logUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-800">Activity log</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <p className="mb-4 text-xs text-slate-500">{name}</p>

        {err ? (
          <div className="text-sm text-rose-600">{err}</div>
        ) : !data ? (
          <div className="py-8 text-center text-slate-400">Loading…</div>
        ) : data.entries.length === 0 ? (
          <div className="py-8 text-center text-slate-400">Nothing has been sent to this lead yet.</div>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {data.entries.map((e, i) => {
              const s = STATUS[e.status] ?? STATUS.PENDING;
              const when = e.status === 'DONE' ? e.at : e.scheduledFor;
              // For a sent action, also surface the time it was originally scheduled
              // when that differs (>1 min) from when it actually went out — makes
              // pacing/bursts and deferrals visible instead of hidden.
              const drift = e.status === 'DONE' && e.scheduledFor
                ? Math.abs(new Date(e.at).getTime() - new Date(e.scheduledFor).getTime())
                : 0;
              return (
                <li key={i} className="relative">
                  <span className={`absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full ${s.dot}`} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{e.label}</span>
                    <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.status === 'DONE' ? 'on ' : 'due '}{new Date(when).toLocaleString()}
                    {drift > 60_000 && (
                      <span className="text-slate-400"> · was scheduled for {new Date(e.scheduledFor).toLocaleTimeString()}</span>
                    )}
                  </div>
                  {e.error && <div className="mt-0.5 text-xs text-rose-600">{e.error}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
