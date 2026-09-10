'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/ui';
import { cohortRef } from '@/lib/cohorts';

interface RecentCohort {
  id: string;
  label: string;
  monthIndex: number;
  subIndex?: number | null;
  status: string;
  startDate: string;
  clientId: string;
  clientName?: string | null;
  contacts: number;
  sent: number;
  replies: number;
}

interface Summary {
  totalCampaigns: number;
  activeCampaigns: number;
  totalCohorts: number;
  activeCohorts: number;
  pendingApprovals: number;
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
  bounceRate: number;
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

export default function DashboardPage() {
  const { user } = useAuth();
  const [cohorts, setCohorts] = useState<RecentCohort[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    api.get<RecentCohort[]>('/dashboard/recent-cohorts').then(setCohorts).catch(() => {});
    api.get<Summary>('/dashboard/summary').then(setSummary).catch(() => {});
  }, [user]);

  const pending = summary?.pendingApprovals ?? 0;

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
        title={`Welcome, ${user?.name ?? ''}`}
        subtitle="Your outreach at a glance"
      />

      {showLi && <div className="mb-3 text-sm font-semibold text-slate-500">📧 Email</div>}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {c.value}
            </div>
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

      {user && user.role !== 'USER' && pending > 0 && (
        <Link
          href="/approvals"
          className="mb-6 flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 hover:bg-amber-100"
        >
          <span>
            <strong>{pending}</strong> item{pending > 1 ? 's' : ''} awaiting your
            approval
          </span>
          <span>→</span>
        </Link>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <span className="font-medium">Recent cohorts</span>
          <Link href="/cohort-schedule" className="text-xs text-brand-600 hover:underline">
            View schedule →
          </Link>
        </div>
        {cohorts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No cohorts yet —{' '}
            <Link href="/clients" className="text-brand-600 hover:underline">
              set up a client and upload a cohort
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Cohort</th>
                <th className="px-5 py-3">Client</th>
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
                    <Link href={`/clients/${c.clientId}`} className="hover:text-brand-600">
                      {cohortRef(c.monthIndex, c.subIndex)} {c.label}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{c.clientName ?? '—'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">{c.contacts}</td>
                  <td className="px-5 py-3 text-slate-600">{c.sent}</td>
                  <td className="px-5 py-3 text-emerald-600">{c.replies}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(c.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
