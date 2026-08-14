'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface BellItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

const ICON: Record<string, string> = {
  update: '🔔', 'internal-work': '🗒', support: '🎧', reporting: '📋', broadcast: '📢',
};

/** Global notification bell — shown in every panel (admin, sub-admin, sales, client).
 *  Reuses the shared bell feed (Notification table). */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[]>([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<{ unread: number; items: BellItem[] }>('/updates/bell/feed')
      .then((r) => { setItems(r.items); setUnread(r.unread); })
      .catch(() => {});
  }, []);

  // Poll + refresh on any of the app's "*-changed" signals.
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const on = () => load();
    ['updates-changed', 'internal-work-changed', 'support-changed', 'broadcasts-changed'].forEach((e) => window.addEventListener(e, on));
    return () => { clearInterval(id); ['updates-changed', 'internal-work-changed', 'support-changed', 'broadcasts-changed'].forEach((e) => window.removeEventListener(e, on)); };
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function markAll() {
    await api.post('/updates/bell/seen', {}).catch(() => {});
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    window.dispatchEvent(new Event('updates-changed'));
  }
  function openItem(it: BellItem) {
    setOpen(false);
    if (it.link) router.push(it.link);
  }

  return (
    <div className="fixed right-4 top-3 z-[60]" ref={boxRef}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-lg shadow-sm hover:bg-slate-50"
        aria-label="Notifications"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-brand-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">You&apos;re all caught up 🎉</div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => openItem(it)}
                  className={`flex w-full items-start gap-2.5 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${it.read ? '' : 'bg-brand-50/40'}`}
                >
                  <span className="mt-0.5 text-base">{ICON[it.type] ?? '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {!it.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />}
                      <span className="truncate text-sm font-medium text-slate-800">{it.title}</span>
                    </span>
                    {it.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{it.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(it.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
