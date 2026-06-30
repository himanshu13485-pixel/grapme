'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/clients', label: 'Clients Workspace', icon: '🏢', admin: true },
  { href: '/cohort-schedule', label: 'Cohort Schedule', icon: '📅', admin: true },
  { href: '/campaigns', label: 'Campaigns', icon: '✈' },
  { href: '/contacts', label: 'Contacts', icon: '☰' },
  { href: '/templates', label: 'Templates', icon: '❏' },
  { href: '/mailbox', label: 'Inbox & Sent', icon: '📥', inboxBadge: true },
  { href: '/mailboxes', label: 'Mailboxes', icon: '✉' },
  { href: '/deliverability', label: 'Deliverability', icon: '◎' },
  { href: '/credits', label: 'Credits', icon: '◈' },
  { href: '/approvals', label: 'Approvals', icon: '✓', admin: true },
  { href: '/compliance', label: 'Compliance', icon: '⚖', admin: true },
  { href: '/sub-admins', label: 'Sub Admins', icon: '⚇', admin: true },
  { href: '/activity-logs', label: 'Activity Logs', icon: '◷', admin: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState('');
  const prevUnread = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // Poll the unread-reply count so the Inbox badge stays live and we can alert
  // when a new reply lands — anywhere in the app, not just on the Inbox page.
  useEffect(() => {
    if (!user) return;
    let stop = false;

    async function check() {
      try {
        const { count } = await api.get<{ count: number }>('/mailbox/unread');
        if (stop) return;
        const prev = prevUnread.current;
        if (prev !== null && count > prev) {
          const delta = count - prev;
          setToast(`📬 ${delta} new repl${delta === 1 ? 'y' : 'ies'} received`);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(''), 8000);
          // Optional desktop notification if the user granted permission.
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('New reply received', {
              body: `${delta} new message(s) in your Inbox`,
            });
          }
        }
        prevUnread.current = count;
        setUnread(count);
      } catch {
        /* ignore transient errors */
      }
    }

    check();
    const id = setInterval(check, 60_000);
    // Let the Inbox view tell us it just marked things read, so the badge clears
    // immediately instead of waiting for the next poll.
    const onRead = () => check();
    window.addEventListener('inbox-read', onRead);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('inbox-read', onRead);
    };
  }, [user]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN';
  const nav = NAV.filter((n) => !n.admin || isAdmin);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            ✉
          </div>
          <span className="font-semibold text-slate-800">AEO</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="w-4 text-center">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.inboxBadge && unread > 0 && (
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">
            {user.name}
          </div>
          <div className="mb-3 text-xs text-slate-400">{user.role}</div>
          <button onClick={logout} className="btn-ghost w-full text-xs">
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto px-8 py-8">{children}</main>

      {/* New-mail alert toast */}
      {toast && (
        <button
          onClick={() => {
            setToast('');
            router.push('/mailbox');
          }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800"
        >
          {toast}
          <span className="text-xs text-slate-300">— view</span>
        </button>
      )}
    </div>
  );
}
