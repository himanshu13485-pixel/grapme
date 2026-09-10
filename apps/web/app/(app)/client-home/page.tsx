'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/ui';
import { ValidityBadge } from '@/components/Validity';
import { cohortRef } from '@/lib/cohorts';

interface Summary {
  totalCampaigns: number;
  activeCohorts: number;
  sent: number;
  delivered: number;
  deliveryRate: number;
  opens: number;
  clicks: number;
  replies: number;
  forwarded: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  forwardRate: number;
  linkedin?: {
    accountsConnected: number;
    invitesSent: number;
    connected: number;
    leads: number;
    replies: number;
    acceptanceRate: number;
    replyRate: number;
  };
}

interface RecentCohort {
  id: string;
  label: string;
  monthIndex: number;
  subIndex?: number | null;
  status: string;
  startDate: string;
  clientId: string;
  contacts: number;
  sent: number;
  replies: number;
}

interface Client {
  id: string;
  name: string;
  status: string;
  serviceType?: string | null;
  emailEnabled?: boolean;
  linkedInEnabled?: boolean;
  validityDays?: number | null;
  validityStartAt?: string | null;
  stats?: { emailSent: number; emailOpens: number; emailClicks: number; contacts: number; liInvites: number; liConnected: number; liLeads: number };
}

interface SetupProgress {
  workspaces: { id: string; name: string; total: number; finished: number; started: number; percent: number }[];
  overall: { total: number; finished: number; percent: number };
}

export default function ClientHomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cohorts, setCohorts] = useState<RecentCohort[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupProgress | null>(null);

  useEffect(() => {
    api.get<Summary>('/dashboard/summary').then(setSummary).catch(() => {});
    api.get<RecentCohort[]>('/dashboard/recent-cohorts').then(setCohorts).catch(() => {});
    api.get<SetupProgress>('/reporting/my-progress').then(setSetup).catch(() => {});
    api
      .get<Client[]>('/clients')
      .then(setClients)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Daily greeting — shown once per day (per browser) on portal open.
  useEffect(() => {
    if (!user) return;
    const today = new Date().toDateString();
    const key = `grapout-greeting-${user.id}`;
    if (typeof window !== 'undefined' && localStorage.getItem(key) === today) return;
    api
      .get<{ enabled: boolean; message: string | null }>('/greetings/today')
      .then((r) => {
        if (r.enabled && r.message) {
          setGreeting(r.message);
          try {
            localStorage.setItem(key, today);
          } catch {
            /* ignore storage errors */
          }
        }
      })
      .catch(() => {});
  }, [user]);

  const hour = new Date().getHours();
  const salute = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  // Same KPI set as the admin dashboard, scoped to this client's data.
  const cards = [
    { label: 'Active cohorts', value: summary?.activeCohorts ?? 0 },
    { label: 'Emails sent', value: summary?.sent ?? 0 },
    { label: 'Delivered', value: summary?.delivered ?? 0 },
    { label: 'Delivery rate', value: `${summary?.deliveryRate ?? 0}%` },
    { label: 'Replies', value: summary?.replies ?? 0 },
    { label: 'Reply rate', value: `${summary?.replyRate ?? 0}%` },
    { label: 'Forwarded', value: summary?.forwarded ?? 0 },
    { label: 'Forward rate', value: `${summary?.forwardRate ?? 0}%` },
    { label: 'Opens', value: summary?.opens ?? 0 },
    { label: 'Open rate', value: `${summary?.openRate ?? 0}%` },
    { label: 'Clicks', value: summary?.clicks ?? 0 },
    { label: 'Click rate', value: `${summary?.clickRate ?? 0}%` },
    { label: 'Total campaigns', value: summary?.totalCampaigns ?? 0 },
  ];

  const li = summary?.linkedin;
  const showLi = !!li && (li.accountsConnected > 0 || li.leads > 0 || li.invitesSent > 0);
  const liCards = [
    { label: 'Accounts connected', value: li?.accountsConnected ?? 0 },
    { label: 'Invites sent', value: li?.invitesSent ?? 0 },
    { label: 'Connected', value: li?.connected ?? 0 },
    { label: 'Acceptance rate', value: `${li?.acceptanceRate ?? 0}%` },
    { label: 'Replies', value: li?.replies ?? 0 },
    { label: 'Reply rate', value: `${li?.replyRate ?? 0}%` },
    { label: 'Total leads', value: li?.leads ?? 0 },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name}` : ''}`}
        subtitle="Your outreach at a glance"
      />

      {greeting && (
        <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white shadow-lg">
          <button
            onClick={() => setGreeting(null)}
            className="absolute right-3 top-3 text-white/70 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
          <div className="text-lg font-bold">
            {salute}
            {user?.name ? `, ${user.name}` : ''} 👋
          </div>
          <div className="mt-1 text-sm text-emerald-50">{greeting}</div>
        </div>
      )}

      {loaded && clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="mb-4 text-slate-500">
            You don&apos;t have a workspace yet. Set one up to start your outreach.
          </p>
          <Link
            href="/clients?new=1"
            className="inline-block rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
          >
            + Set up my workspace
          </Link>
        </div>
      ) : (
        <>
          {/* Account Setup progress — overall onboarding completion (no step details). */}
          {setup && setup.overall.total > 0 && (
            <div className="mb-8 card p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-600">Account Setup</div>
                <div className="text-2xl font-bold text-slate-900">{setup.overall.percent}%</div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${setup.overall.percent >= 100 ? 'bg-emerald-500' : setup.overall.percent > 0 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-slate-300'}`}
                  style={{ width: `${Math.min(100, Math.max(0, setup.overall.percent))}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs text-slate-400">
                {setup.overall.finished} of {setup.overall.total} setup steps completed
                {setup.overall.percent >= 100 ? ' — all set 🎉' : ''}
              </div>
              {setup.workspaces.length > 1 && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {setup.workspaces.map((w) => (
                    <div key={w.id} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-xs text-slate-500" title={w.name}>{w.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${w.percent >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${w.percent}%` }} />
                      </div>
                      <span className="w-9 shrink-0 text-right text-xs font-medium text-slate-600">{w.percent}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* KPI cards — same content as the admin dashboard */}
          {showLi && <div className="mb-3 text-sm font-semibold text-slate-500">📧 Email</div>}
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="card p-5">
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{c.value}</div>
              </div>
            ))}
          </div>

          {showLi && (
            <>
              <div className="mb-3 text-sm font-semibold text-slate-500">🔗 LinkedIn</div>
              <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
                {liCards.map((c) => (
                  <div key={c.label} className="card p-5">
                    <div className="text-sm text-slate-500">{c.label}</div>
                    <div className="mt-2 text-3xl font-semibold text-slate-900">{c.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Workspace boxes — same layout as the admin/salesperson workspace card. */}
          {clients.length > 0 && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {clients.map((c) => {
                const active = (c.status ?? 'active').toLowerCase() === 'active';
                const ws = setup?.workspaces.find((w) => w.id === c.id);
                return (
                  <div key={c.id} className="card p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-800">{c.name}</div>
                        <div className="mt-1"><ValidityBadge days={c.validityDays} startAt={c.validityStartAt} /></div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {c.emailEnabled !== false && (
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <MiniStat label="Sent" value={c.stats?.emailSent ?? 0} />
                        <MiniStat label="Opens / Clicks" value={`${c.stats?.emailOpens ?? 0} / ${c.stats?.emailClicks ?? 0}`} />
                        <MiniStat label="Contacts" value={c.stats?.contacts ?? 0} />
                      </div>
                    )}
                    {c.linkedInEnabled && (
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <MiniStat label="Invites" value={c.stats?.liInvites ?? 0} />
                        <MiniStat label="Connected" value={c.stats?.liConnected ?? 0} />
                        <MiniStat label="Leads" value={c.stats?.liLeads ?? 0} />
                      </div>
                    )}

                    {ws && ws.total > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                          <span>Account Setup</span><span className="text-slate-700">{ws.percent}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${ws.percent >= 100 ? 'bg-emerald-500' : ws.percent > 0 ? 'bg-emerald-400' : 'bg-slate-300'}`} style={{ width: `${Math.min(100, Math.max(0, ws.percent))}%` }} />
                        </div>
                      </div>
                    )}

                    <div className="mt-3 text-right">
                      <Link href={`/clients/${c.id}`} className="text-xs font-medium text-emerald-600 hover:underline">Open workspace →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent cohorts — same table as the admin dashboard */}
          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4 font-medium">Recent cohorts</div>
            {cohorts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">No cohorts yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Cohort</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Contacts</th>
                      <th className="px-5 py-3">Sent</th>
                      <th className="px-5 py-3">Replies</th>
                      <th className="px-5 py-3">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-5 py-3 font-medium">
                          <Link href={`/clients/${c.clientId}`} className="hover:text-emerald-600">
                            {cohortRef(c.monthIndex, c.subIndex)} {c.label}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-5 py-3 text-slate-500">{c.contacts}</td>
                        <td className="px-5 py-3 text-slate-600">{c.sent}</td>
                        <td className="px-5 py-3 text-emerald-600">{c.replies}</td>
                        <td className="px-5 py-3 text-slate-400">
                          {new Date(c.startDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-base font-bold text-slate-800">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
