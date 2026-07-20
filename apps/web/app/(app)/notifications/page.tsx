'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';

interface Note {
  recipientId: string;
  read: boolean;
  id: string;
  title: string;
  bodyHtml: string;
  signatureHtml: string | null;
  from: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get<Note[]>('/broadcasts/my').then(setNotes).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function open(n: Note) {
    setOpenId(openId === n.recipientId ? null : n.recipientId);
    if (!n.read) {
      try {
        await api.post(`/broadcasts/my/${n.recipientId}/read`);
        setNotes((prev) => prev.map((x) => (x.recipientId === n.recipientId ? { ...x, read: true } : x)));
        window.dispatchEvent(new Event('broadcasts-changed'));
      } catch { /* ignore */ }
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notification" subtitle="Announcements from your account team." />

      {loading ? (
        <div className="p-8 text-center text-slate-400">Loading…</div>
      ) : notes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          No notifications yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => {
            const isOpen = openId === n.recipientId;
            return (
              <div key={n.recipientId} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${n.read ? 'border-slate-200' : 'border-brand-300'}`}>
                <button onClick={() => open(n)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                  {!n.read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${n.read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</div>
                    <div className="text-xs text-slate-400">
                      {n.from ? `${n.from} · ` : ''}{new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 px-5 py-4">
                    <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: n.bodyHtml }} />
                    {n.signatureHtml && (
                      <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: n.signatureHtml }} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
