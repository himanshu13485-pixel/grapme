'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/campaigns', label: 'Campaigns', icon: '✈' },
  { href: '/contacts', label: 'Contacts', icon: '☰' },
  { href: '/templates', label: 'Templates', icon: '❏' },
  { href: '/mailbox', label: 'Inbox & Sent', icon: '📥' },
  { href: '/mailboxes', label: 'Mailboxes', icon: '✉' },
  { href: '/credits', label: 'Credits', icon: '◈' },
  { href: '/approvals', label: 'Approvals', icon: '✓', admin: true },
  { href: '/sub-admins', label: 'Sub Admins', icon: '⚇', admin: true },
  { href: '/activity-logs', label: 'Activity Logs', icon: '◷', admin: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

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
                {item.label}
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
    </div>
  );
}
