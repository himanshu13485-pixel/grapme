'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/ui';
import { ValidityBadge } from '@/components/Validity';

interface Summary {
  totalCampaigns: number;
  activeCohorts: number;
  sent: number;
  delivered: number;
  deliveryRate: number;
  opens: number;
  replies: number;
  forwarded: number;
  openRate: number;
  replyRate: number;
  forwardRate: number;
}

interface RecentCohort {
  id: string;
  label: string;
  monthIndex: number;
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
  validityDays?: number | null;
  validityStartAt?: string | null;
}

export default function ClientHomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cohorts, setCohorts] = useState<RecentCohort[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    api.get<Summary>('/dashboard/summary').then(setSummary).catch(() => {});
    api.get<RecentCohort[]>('/dashboard/recent-cohorts').then(setCohorts).catch(() => {});
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
    { label: 'Open rate', value: `${summary?.openRate ?? 0}%` },
    { label: 'Total campaigns', value: summary?.totalCampaigns ?? 0 },
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
          {/* KPI cards — same content as the admin dashboard */}
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="card p-5">
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{c.value}</div>
              </div>
            ))}
          </div>

          {/* Profile status + validity */}
          {clients.length > 0 && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {clients.map((c) => {
                const active = (c.status ?? 'active').toLowerCase() === 'active';
                return (
                  <div key={c.id} className="card flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-800">{c.name}</div>
                      <div className="mt-1">
                        <ValidityBadge days={c.validityDays} startAt={c.validityStartAt} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                      <Link href={`/clients/${c.id}`} className="text-xs font-medium text-emerald-600 hover:underline">
                        Open workspace →
                      </Link>
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
                            #{c.monthIndex} {c.label}
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
