'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, hasStashedAdmin, restoreAdminSession } from '@/lib/api';
import { NotificationBell } from '@/components/NotificationBell';

// `superOnly` items are hidden from sub-admins entirely. All other items are
// gated for sub-admins by their accessModules (unless fullAccess). `module` is
// the access key checked against a sub-admin's granted modules.
// `group` collapses items behind a "More…" toggle: the 'email' group under an
// "Email Outreach" header, the 'linkedin' group under a LinkedIn "More…" toggle.
type NavItem = {
  href: string; label: string; icon: string; module: string;
  admin?: boolean; superOnly?: boolean; sales?: boolean; inboxBadge?: boolean; updatesBadge?: boolean; supportBadge?: boolean; internalBadge?: boolean; group?: 'email' | 'linkedin' | 'main';
};
// Pages a salesperson may reach in their restricted panel (nothing else).
// What the amber impersonation banner calls the account being viewed.
const VIEWING_AS_LABEL: Record<string, string> = {
  CLIENT: 'client',
  SALES: 'salesperson',
  SUB_ADMIN: 'sub-admin',
};

const SALES_ALLOWED = ['/sales-home', '/sales-clients', '/reporting', '/internal-work', '/support', '/updates', '/my-profile'];
const NAV: NavItem[] = [
  // ── Salesperson panel (only these show for role SALES) ──
  { href: '/sales-home', label: 'Dashboard', icon: '▦', sales: true, module: 'sales-home' },
  { href: '/sales-clients', label: 'My Clients', icon: '🏢', sales: true, module: 'sales-clients' },
  // ── Admin / shared ──
  { href: '/dashboard', label: 'Dashboard', icon: '▦', module: 'dashboard' },
  { href: '/updates', label: 'Updates', icon: '🔔', module: 'updates', updatesBadge: true },
  { href: '/registered-clients', label: 'Registered Clients', icon: '👥', admin: true, module: 'registered-clients' },
  { href: '/clients', label: 'Clients Workspace', icon: '🏢', admin: true, module: 'clients' },
  { href: '/reporting', label: 'Reporting', icon: '📋', admin: true, module: 'reporting' },
  { href: '/support', label: 'Client Support', icon: '🎧', module: 'support', supportBadge: true },
  { href: '/broadcasts', label: 'Notifications', icon: '📢', admin: true, module: 'broadcasts' },
  { href: '/internal-work', label: 'Internal Work', icon: '🗒', admin: true, module: 'internal-work', internalBadge: true },
  { href: '/sales-persons', label: 'Sales Persons', icon: '🧑‍💼', admin: true, module: 'sales-persons' },
  { href: '/live-clients', label: 'Live Clients', icon: '🟢', admin: true, module: 'live-clients' },
  { href: '/blog', label: 'Blog', icon: '📝', admin: true, module: 'blog' },
  // ── Email Outreach (collapsed under "More…") ──
  { href: '/cohort-schedule', label: 'Cohort Schedule', icon: '📅', admin: true, module: 'cohort-schedule', group: 'email' },
  { href: '/campaigns', label: 'Campaigns', icon: '✈', module: 'campaigns', group: 'email' },
  { href: '/contacts', label: 'Contacts', icon: '☰', module: 'contacts', group: 'email' },
  { href: '/templates', label: 'Templates', icon: '❏', module: 'templates', group: 'email' },
  { href: '/mailbox', label: 'Inbox & Sent', icon: '📥', inboxBadge: true, module: 'mailbox', group: 'email' },
  { href: '/mailboxes', label: 'Mailboxes', icon: '✉', module: 'mailboxes', group: 'email' },
  { href: '/deliverability', label: 'Deliverability', icon: '◎', module: 'deliverability', group: 'email' },
  { href: '/email-log', label: 'Email Log', icon: '🧾', admin: true, module: 'email-log', group: 'email' },
  // ── LinkedIn Outreach ──
  { href: '/linkedin', label: 'LinkedIn Outreach', icon: '🔗', admin: true, module: 'linkedin' },
  { href: '/linkedin-schedule', label: 'LinkedIn Campaigns Schedule', icon: '🗓', admin: true, module: 'linkedin-schedule' },
  { href: '/linkedin-inbox', label: 'LinkedIn Inbox', icon: '📨', admin: true, module: 'linkedin-inbox', group: 'linkedin' },
  { href: '/linkedin-leads', label: 'LinkedIn Leads', icon: '🧲', admin: true, module: 'linkedin-leads', group: 'linkedin' },
  { href: '/linkedin-log', label: 'LinkedIn Log', icon: '🧾', admin: true, module: 'linkedin-log', group: 'linkedin' },
  // ── Main Menu (collapsed folder: Approvals → Messaging) ──
  { href: '/validity', label: 'Subscription Management', icon: '🔁', admin: true, module: 'validity', group: 'main' },
  { href: '/approvals', label: 'Approvals', icon: '✓', admin: true, module: 'approvals', group: 'main' },
  { href: '/compliance', label: 'Compliance', icon: '⚖', admin: true, module: 'compliance', group: 'main' },
  { href: '/duplicate-emails', label: 'Duplicate Email', icon: '⧉', admin: true, module: 'duplicate-emails', group: 'main' },
  { href: '/greetings', label: 'Greetings', icon: '👋', admin: true, module: 'greetings', group: 'main' },
  { href: '/sub-admins', label: 'Sub Admins', icon: '⚇', admin: true, superOnly: true, module: 'sub-admins', group: 'main' },
  { href: '/activity-logs', label: 'Activity Logs', icon: '◷', admin: true, module: 'activity-logs', group: 'main' },
  { href: '/pricing', label: 'Membership', icon: '🪙', module: 'pricing', group: 'main' },
  { href: '/plans', label: 'Set Membership', icon: '🏷', admin: true, module: 'plans', group: 'main' },
  { href: '/plan-requests', label: 'Plan Upgrade Request', icon: '🧾', admin: true, module: 'plan-requests', group: 'main' },
  { href: '/billing', label: 'Payment / Billing', icon: '💳', admin: true, module: 'billing', group: 'main' },
  { href: '/whatsapp', label: 'Messaging', icon: '💬', admin: true, module: 'whatsapp', group: 'main' },
  // ── everything else ──
  { href: '/my-profile', label: 'My Account', icon: '👤', module: 'my-profile' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [unread, setUnread] = useState(0);
  const [updatesUnread, setUpdatesUnread] = useState(0);
  const [supportUnread, setSupportUnread] = useState(0);
  const [internalUnread, setInternalUnread] = useState(0);
  const [broadcastUnread, setBroadcastUnread] = useState(0);
  const [toast, setToast] = useState('');
  const [updatesToast, setUpdatesToast] = useState('');
  const prevUnread = useRef<number | null>(null);
  const prevUpdates = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatesToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientProfiles, setClientProfiles] = useState<
    { id: string; name: string; serviceType?: string | null; plan?: string }[]
  >([]);
  const [planColors, setPlanColors] = useState<Record<string, string>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [liMoreOpen, setLiMoreOpen] = useState(false);
  const [mainOpen, setMainOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // Are we inside an admin "Login as" impersonation? (stashed admin session present)
  useEffect(() => { setImpersonating(hasStashedAdmin()); }, [user]);
  function backToAdmin() {
    const back = restoreAdminSession();
    // Land on the page the admin left, not a fixed one — they now start this
    // from Registered Clients, Sales Persons or Sub Admins.
    if (back) window.location.href = back;
  }

  // Salespersons live entirely inside their restricted panel — land them on
  // their dashboard and keep them out of any other route.
  useEffect(() => {
    if (user?.role !== 'SALES') return;
    const allowed = SALES_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!allowed) router.replace('/sales-home');
  }, [user, pathname, router]);

  // Client Support unread badge (open/answered for clients; open/escalated for staff),
  // polled for everyone. Refreshed when a support view signals a change.
  useEffect(() => {
    if (!user) return;
    let stop = false;
    async function check() {
      try {
        const { count } = await api.get<{ count: number }>('/support/badge');
        if (!stop) setSupportUnread(count);
      } catch { /* ignore */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onChanged = () => check();
    window.addEventListener('support-changed', onChanged);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('support-changed', onChanged);
    };
  }, [user]);

  // Internal Work unread badge — staff (admins, sub-admins, salespersons).
  useEffect(() => {
    if (!user || user.role === 'CLIENT') return;
    let stop = false;
    async function check() {
      try {
        const { count } = await api.get<{ count: number }>('/internal-work/unread');
        if (!stop) setInternalUnread(count);
      } catch { /* ignore */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onChanged = () => check();
    window.addEventListener('internal-work-changed', onChanged);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('internal-work-changed', onChanged);
    };
  }, [user]);

  // Client "Notification" (admin broadcasts) unread badge — clients only.
  useEffect(() => {
    if (user?.role !== 'CLIENT') return;
    let stop = false;
    async function check() {
      try {
        const { count } = await api.get<{ count: number }>('/broadcasts/my/unread');
        if (!stop) setBroadcastUnread(count);
      } catch { /* ignore */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onChanged = () => check();
    window.addEventListener('broadcasts-changed', onChanged);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('broadcasts-changed', onChanged);
    };
  }, [user]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [pathname]);

  // Auto-open a collapsed nav group when the current route lives inside it.
  useEffect(() => {
    const inGroup = (g: 'email' | 'linkedin' | 'main') =>
      NAV.filter((n) => n.group === g).some((n) => pathname.startsWith(n.href));
    if (inGroup('email')) setEmailOpen(true);
    if (inGroup('linkedin')) setLiMoreOpen(true);
    if (inGroup('main')) setMainOpen(true);
  }, [pathname]);

  // Client portal is themed by the client's membership colour.
  useEffect(() => {
    if (user?.role !== 'CLIENT') return;
    api
      .get<{ name: string; color: string }[]>('/plans')
      .then((rows) => setPlanColors(Object.fromEntries(rows.map((p) => [p.name, p.color]))))
      .catch(() => {});
  }, [user]);

  // Client-portal users: load their owned profiles, and land them on one.
  useEffect(() => {
    if (user?.role !== 'CLIENT') return;
    api
      .get<{ id: string; name: string; serviceType?: string | null; plan?: string }[]>('/my/clients')
      .then((profiles) => {
        setClientProfiles(profiles);
        // Land them on their dashboard home — but leave them wherever they
        // already are within their own portal pages.
        if (
          !pathname.startsWith('/clients') &&
          !pathname.startsWith('/support') &&
          pathname !== '/my-profile' &&
          pathname !== '/client-home' &&
          pathname !== '/updates' &&
          pathname !== '/notifications' &&
          pathname !== '/my-email-log' &&
          pathname !== '/pricing' &&
          pathname !== '/subscription'
        ) {
          router.replace('/client-home');
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  // Notification-bell (Updates board) unread count, polled + refreshed whenever the
  // board opens/clears a thread. Shown as a badge on the "Updates" nav item, with a
  // toast when a genuinely new update arrives.
  useEffect(() => {
    if (!user) return;
    let stop = false;
    async function check() {
      try {
        const { count } = await api.get<{ count: number }>('/updates/bell/unread');
        if (stop) return;
        const prev = prevUpdates.current;
        if (prev !== null && count > prev && pathname !== '/updates') {
          setUpdatesToast(`🔔 ${count - prev} new update${count - prev === 1 ? '' : 's'}`);
          if (updatesToastTimer.current) clearTimeout(updatesToastTimer.current);
          updatesToastTimer.current = setTimeout(() => setUpdatesToast(''), 8000);
        }
        prevUpdates.current = count;
        setUpdatesUnread(count);
      } catch { /* ignore */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onChanged = () => check();
    window.addEventListener('updates-changed', onChanged);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('updates-changed', onChanged);
    };
  }, [user, pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  const nav = NAV.filter((n) => {
    // Salespersons get a strictly restricted panel: only their own pages.
    if (user.role === 'SALES') return SALES_ALLOWED.includes(n.href);
    // The salesperson-only items never show for anyone else.
    if (n.sales) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    if (user.role === 'SUB_ADMIN') {
      if (n.superOnly) return false; // e.g. managing other sub-admins
      if (n.href === '/my-profile') return true; // own account: messaging/notify prefs
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
        : user.role === 'CLIENT'
          ? 'Client'
          : user.role === 'SALES'
            ? 'Salesperson'
            : 'User';

  // ── Client portal: themed by the client's membership colour ──
  if (user.role === 'CLIENT') {
    const activeProfile =
      clientProfiles.find((p) => pathname.startsWith(`/clients/${p.id}`)) ??
      clientProfiles[0];
    const themeColor =
      (activeProfile?.plan && planColors[activeProfile.plan]) || '#0f766e';
    const sidebarBg = `linear-gradient(180deg, color-mix(in srgb, ${themeColor} 88%, black), color-mix(in srgb, ${themeColor} 42%, black))`;
    const mainBg = `color-mix(in srgb, ${themeColor} 7%, #f8fafc)`;

    return (
      <div className="flex min-h-screen">
        <NotificationBell />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col text-white/85 shadow-xl transition-transform duration-200 md:sticky md:top-0 md:z-auto md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ background: sidebarBg }}
        >
          <div className="flex items-center gap-3 px-5 py-6">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-lg font-black shadow-lg"
              style={{ color: themeColor }}
            >
              G
            </div>
            <div className="leading-tight">
              <div className="text-base font-extrabold tracking-tight text-white">GrapMe</div>
              <div className="text-[10px] font-medium tracking-wide text-white/60">GVC Framework · Client Portal</div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            <ClientNavItem
              href="/client-home"
              active={pathname === '/client-home'}
              icon="▦"
              label="Dashboard"
              color={themeColor}
            />
            <ClientNavItem
              href="/updates"
              active={pathname === '/updates'}
              icon="🔔"
              label="Updates"
              color={themeColor}
              badge={updatesUnread > 0 ? (
                <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">{updatesUnread}</span>
              ) : null}
            />
            <ClientNavItem
              href="/notifications"
              active={pathname === '/notifications'}
              icon="📢"
              label="Notification"
              color={themeColor}
              badge={broadcastUnread > 0 ? (
                <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">{broadcastUnread}</span>
              ) : null}
            />
            <ClientNavItem
              href="/support"
              active={pathname === '/support'}
              icon="🎧"
              label="Client Support"
              color={themeColor}
              badge={supportUnread > 0 ? (
                <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">{supportUnread}</span>
              ) : null}
            />
            <ClientNavItem
              href="/my-email-log"
              active={pathname === '/my-email-log'}
              icon="🧾"
              label="Email Log"
              color={themeColor}
            />

            <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              My workspace{clientProfiles.length > 1 ? 's' : ''}
            </div>
            {clientProfiles.map((p) => {
              const active = pathname.startsWith(`/clients/${p.id}`);
              const badge = p.serviceType ? (
                <span
                  title={
                    p.serviceType === 'BOTH'
                      ? 'Export & Import'
                      : p.serviceType === 'EXPORT'
                        ? 'Export'
                        : 'Import'
                  }
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                    active ? 'bg-white' : 'bg-white/20 text-white'
                  }`}
                  style={active ? { color: themeColor } : undefined}
                >
                  {p.serviceType === 'BOTH'
                    ? 'Export/Import'
                    : p.serviceType === 'EXPORT'
                      ? 'Export'
                      : 'Import'}
                </span>
              ) : null;
              return (
                <ClientNavItem
                  key={p.id}
                  href={`/clients/${p.id}`}
                  active={active}
                  icon="🏢"
                  label={p.name}
                  color={themeColor}
                  badge={badge}
                />
              );
            })}
            {clientProfiles.length === 0 && (
              <div className="px-3 py-2 text-xs text-white/60">No workspace assigned yet.</div>
            )}
            {clientProfiles.length < (user.profileLimit ?? 1) && (
              <ClientNavItem
                href="/clients?new=1"
                active={pathname === '/clients'}
                icon="＋"
                label={clientProfiles.length === 0 ? 'Set up my workspace' : 'Add profile'}
                color={themeColor}
                dashed
              />
            )}

            <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Account
            </div>
            <ClientNavItem
              href="/my-profile"
              active={pathname === '/my-profile'}
              icon="👤"
              label="My Profile"
              color={themeColor}
            />
            <ClientNavItem
              href="/pricing"
              active={pathname === '/pricing'}
              icon="🪙"
              label="Membership"
              color={themeColor}
            />
            <ClientNavItem
              href="/subscription"
              active={pathname === '/subscription'}
              icon="🔁"
              label="Subscription"
              color={themeColor}
            />
          </nav>

          <div className="border-t border-white/10 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-lg"
                style={{ background: `color-mix(in srgb, ${themeColor} 70%, black)` }}
              >
                {initials}
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold text-white">{user.name}</div>
                <div className="text-[11px] text-white/60">
                  Client{activeProfile?.plan ? ` · ${activeProfile.plan}` : ''}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 transition hover:bg-white/15 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonating && (
            <ImpersonationBanner name={user.name} role={user.role} onBack={backToAdmin} />
          )}
          <MobileTopBar onMenu={() => setSidebarOpen(true)} />
          <main
            className="flex-1 overflow-auto px-4 py-5 md:px-8 md:py-8"
            style={{ background: mainBg }}
          >
            {children}
          </main>
        </div>
        {toast && (
          <button
            onClick={() => setToast('')}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg"
            style={{ background: `color-mix(in srgb, ${themeColor} 80%, black)` }}
          >
            {toast}
          </button>
        )}
        {updatesToast && (
          <button
            onClick={() => { setUpdatesToast(''); router.push('/updates'); }}
            className="fixed bottom-24 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
          >
            {updatesToast}
            <span className="text-xs text-slate-300">— view</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <NotificationBell />
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col bg-sidebar-gradient text-indigo-100 shadow-xl transition-transform duration-200 md:sticky md:top-0 md:z-auto md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-lg font-black text-brand-700 shadow-glow">
            G
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold tracking-tight text-white">GrapMe</div>
            <div className="text-[10px] font-medium tracking-wide text-indigo-300">GVC Framework</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {(() => {
            const renderLink = (item: NavItem) => {
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
                  {item.updatesBadge && updatesUnread > 0 && (
                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
                      {updatesUnread}
                    </span>
                  )}
                  {item.supportBadge && supportUnread > 0 && (
                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
                      {supportUnread}
                    </span>
                  )}
                  {item.internalBadge && internalUnread > 0 && (
                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
                      {internalUnread}
                    </span>
                  )}
                </Link>
              );
            };
            const groupToggle = (key: string, icon: string, label: string, open: boolean, onClick: () => void) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-indigo-100 transition-all hover:bg-white/10 hover:text-white"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-sm text-indigo-100 group-hover:bg-white/20">{icon}</span>
                <span className="flex-1 text-left">{label}</span>
                <span className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
              </button>
            );

            const els: React.ReactNode[] = [];
            let emailHeaderDone = false;
            let liMoreDone = false;
            let mainHeaderDone = false;
            for (const item of nav) {
              if (item.group === 'email') {
                if (!emailHeaderDone) {
                  emailHeaderDone = true;
                  els.push(groupToggle('email-hdr', '📧', 'Email Outreach', emailOpen, () => setEmailOpen((o) => !o)));
                }
                if (emailOpen) els.push(renderLink(item));
              } else if (item.group === 'linkedin') {
                if (!liMoreDone) {
                  liMoreDone = true;
                  els.push(groupToggle('li-more', '⋯', 'More…', liMoreOpen, () => setLiMoreOpen((o) => !o)));
                }
                if (liMoreOpen) els.push(renderLink(item));
              } else if (item.group === 'main') {
                if (!mainHeaderDone) {
                  mainHeaderDone = true;
                  els.push(groupToggle('main-hdr', '📂', 'Main Menu', mainOpen, () => setMainOpen((o) => !o)));
                }
                if (mainOpen) els.push(renderLink(item));
              } else {
                els.push(renderLink(item));
              }
            }
            return els;
          })()}
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
      <div className="flex min-w-0 flex-1 flex-col">
        {impersonating && (
          <ImpersonationBanner name={user.name} role={user.role} onBack={backToAdmin} />
        )}
        <MobileTopBar onMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>

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
      {/* New-update (bell) alert toast */}
      {updatesToast && (
        <button
          onClick={() => { setUpdatesToast(''); router.push('/updates'); }}
          className="fixed bottom-24 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
        >
          {updatesToast}
          <span className="text-xs text-slate-300">— view</span>
        </button>
      )}
    </div>
  );
}

function ClientNavItem({
  href,
  active,
  icon,
  label,
  color,
  badge,
  dashed,
}: {
  href: string;
  active: boolean;
  icon: string;
  label: string;
  color: string;
  badge?: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
        dashed ? 'border border-dashed border-white/20 ' : ''
      }${
        active
          ? 'bg-white shadow-lg'
          : 'text-white/85 hover:translate-x-0.5 hover:bg-white/10 hover:text-white'
      }`}
      style={active ? { color } : undefined}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs ${
          active ? 'text-white' : 'bg-white/10 text-white/85'
        }`}
        style={active ? { background: color } : undefined}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}

/** Amber bar shown while an admin is signed in as someone else, with the one
 *  click back to their own session. Rendered by both layout branches so it is
 *  there whichever workspace the admin is viewing. */
function ImpersonationBanner({
  name,
  role,
  onBack,
}: {
  name: string;
  role: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-white shadow md:px-8">
      <span className="min-w-0 truncate">
        👁 Viewing as <strong>{name}</strong> ({VIEWING_AS_LABEL[role] ?? 'account'}) — you’re
        impersonating this account, and anything you do is recorded against them.
      </span>
      <button
        onClick={onBack}
        className="shrink-0 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow hover:bg-white"
      >
        ← Back to Admin
      </button>
    </div>
  );
}

// Compact top bar shown only on small screens, with a hamburger to open the
// sidebar drawer. Hidden from md upward where the sidebar is always visible.
function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span className="text-sm font-extrabold tracking-tight text-slate-800">GrapMe</span>
    </header>
  );
}
