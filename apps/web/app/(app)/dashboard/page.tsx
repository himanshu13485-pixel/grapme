'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  status: string;
  clientLabel?: string;
  _count?: { messages: number; steps: number };
}

interface Summary {
  totalCampaigns: number;
  activeCampaigns: number;
  totalCohorts: number;
  activeCohorts: number;
  pendingApprovals: number;
  sent: number;
  opens: number;
  replies: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    api.get<Campaign[]>('/campaigns').then(setCampaigns).catch(() => {});
    api.get<Summary>('/dashboard/summary').then(setSummary).catch(() => {});
  }, [user]);

  const pending = summary?.pendingApprovals ?? 0;

  const cards = [
    { label: 'Total campaigns', value: summary?.totalCampaigns ?? 0 },
    { label: 'Active cohorts', value: summary?.activeCohorts ?? 0 },
    { label: 'Emails sent', value: summary?.sent ?? 0 },
    { label: 'Replies', value: summary?.replies ?? 0 },
    { label: 'Open rate', value: `${summary?.openRate ?? 0}%` },
    { label: 'Reply rate', value: `${summary?.replyRate ?? 0}%` },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name ?? ''}`}
        subtitle="Your outreach at a glance"
      />

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {c.value}
            </div>
          </div>
        ))}
      </div>

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
        <div className="border-b border-slate-100 px-5 py-4 font-medium">
          Recent campaigns
        </div>
        {campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No campaigns yet —{' '}
            <Link href="/campaigns" className="text-brand-600 hover:underline">
              create one
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Steps</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.slice(0, 8).map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="hover:text-brand-600"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {c.clientLabel ?? '—'}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {c._count?.steps ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
