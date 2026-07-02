'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

// `superOnly` items are hidden from sub-admins entirely. All other items are
// gated for sub-admins by their accessModules (unless fullAccess). `module` is
// the access key checked against a sub-admin's granted modules.
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦', module: 'dashboard' },
  { href: '/clients', label: 'Clients Workspace', icon: '🏢', admin: true, module: 'clients' },
  { href: '/cohort-schedule', label: 'Cohort Schedule', icon: '📅', admin: true, module: 'cohort-schedule' },
  { href: '/campaigns', label: 'Campaigns', icon: '✈', module: 'campaigns' },
  { href: '/contacts', label: 'Contacts', icon: '☰', module: 'contacts' },
  { href: '/templates', label: 'Templates', icon: '❏', module: 'templates' },
  { href: '/mailbox', label: 'Inbox & Sent', icon: '📥', inboxBadge: true, module: 'mailbox' },
  { href: '/mailboxes', label: 'Mailboxes', icon: '✉', module: 'mailboxes' },
  { href: '/deliverability', label: 'Deliverability', icon: '◎', module: 'deliverability' },
  { href: '/approvals', label: 'Approvals', icon: '✓', admin: true, module: 'approvals' },
  { href: '/compliance', label: 'Compliance', icon: '⚖', admin: true, module: 'compliance' },
  { href: '/sub-admins', label: 'Sub Admins', icon: '⚇', admin: true, superOnly: true, module: 'sub-admins' },
  { href: '/activity-logs', label: 'Activity Logs', icon: '◷', admin: true, module: 'activity-logs' },
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

  const nav = NAV.filter((n) => {
    if (user.role === 'SUPER_ADMIN') return true;
    if (user.role === 'SUB_ADMIN') {
      if (n.superOnly) return false; // e.g. managing other sub-admins
      if (n.href === '/dashboard') return true; // always available
      if (user.fullAccess) return true;
      return (user.accessModules ?? []).includes(n.module);
    }
    // Regular user: only non-admin sections.
    return !n.admin;
  });

  const initials = (user.name || user.email || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const roleLabel =
    user.role === 'SUPER_ADMIN'
      ? 'Super Admin'
      : user.role === 'SUB_ADMIN'
        ? 'Sub Admin'
        : 'User';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 flex-col bg-sidebar-gradient text-indigo-100 shadow-xl">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-lg font-black text-brand-700 shadow-glow">
            G
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold tracking-tight text-white">GRAPOUT</div>
            <div className="text-[10px] font-medium tracking-wide text-indigo-300">GrapOut GVC Framework</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-white text-brand-700 shadow-glow'
                    : 'text-indigo-100 hover:translate-x-0.5 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-center text-sm transition ${
                    active ? 'bg-brand-gradient text-white' : 'bg-white/10 text-indigo-100 group-hover:bg-white/20'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.inboxBadge && unread > 0 && (
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white shadow-glow">
              {initials}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="text-[11px] text-indigo-300">{roleLabel}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-indigo-100 transition hover:bg-white/15 hover:text-white"
          >
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
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
        >
          {toast}
          <span className="text-xs text-indigo-200">— view</span>
        </button>
      )}
    </div>
  );
}
