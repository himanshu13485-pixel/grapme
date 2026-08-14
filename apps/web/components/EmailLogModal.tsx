'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Entry { label: string; at: string; detail: string | null }
interface LogResp {
  subject: string | null;
  contact: { name: string; email: string } | null;
  status: string | null;
  entries: Entry[];
}

const DOT: Record<string, string> = {
  Sent: 'bg-slate-400', Delivered: 'bg-sky-500', Opened: 'bg-emerald-500', Clicked: 'bg-brand-500',
  Replied: 'bg-emerald-600', Bounced: 'bg-rose-500', Failed: 'bg-rose-500', Unsubscribed: 'bg-amber-500', 'Marked as spam': 'bg-rose-600',
};

/** Timeline of one email's activity — sent, delivered, opens, clicks, reply, bounce. */
export function EmailLogModal({ messageId, name, onClose }: { messageId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<LogResp | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<LogResp>(`/email/log/${messageId}`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the log'));
  }, [messageId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-800">Email activity</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <p className="mb-4 text-xs text-slate-500">{name}{data?.subject ? ` · ${data.subject}` : ''}</p>

        {err ? (
          <div className="text-sm text-rose-600">{err}</div>
        ) : !data ? (
          <div className="py-8 text-center text-slate-400">Loading…</div>
        ) : data.entries.length === 0 ? (
          <div className="py-8 text-center text-slate-400">No activity recorded for this email yet.</div>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {data.entries.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[e.label] ?? 'bg-slate-400'}`} />
                <div className="font-medium text-slate-800">{e.label}</div>
                <div className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</div>
                {e.detail && <div className="mt-0.5 truncate text-xs text-brand-600" title={e.detail}>{e.detail}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
