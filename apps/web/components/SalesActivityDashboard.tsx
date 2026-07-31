'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface SalesDashboard {
  email: {
    activeCohorts: number; sent: number; delivered: number; deliveryRate: number;
    opens: number; openRate: number; clicks: number; clickRate: number; replies: number; replyRate: number;
    forwarded: number; forwardRate: number; bounces: number; totalCampaigns: number;
  };
  linkedin: {
    accountsConnected: number; invitesSent: number; connected: number;
    acceptanceRate: number; replies: number; replyRate: number; totalLeads: number;
  };
}

/**
 * The admin-style activity dashboard for the sales panel. Renders the same Email +
 * LinkedIn KPI tiles the admin dashboard shows, for whatever scope is passed:
 * overall (no filters), one client, or one campaign.
 */
export function SalesActivityDashboard({
  clientId,
  campaignId,
  liCampaignId,
  show = 'both',
}: {
  clientId?: string;
  campaignId?: string;
  liCampaignId?: string;
  show?: 'both' | 'email' | 'linkedin';
}) {
  const [d, setD] = useState<SalesDashboard | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (clientId) qs.set('clientId', clientId);
    if (campaignId) qs.set('campaignId', campaignId);
    if (liCampaignId) qs.set('liCampaignId', liCampaignId);
    setD(null);
    api.get<SalesDashboard>(`/sales/my/dashboard${qs.toString() ? `?${qs}` : ''}`).then(setD).catch(() => setD(null));
  }, [clientId, campaignId, liCampaignId]);

  return (
    <div className="space-y-6">
      {(show === 'both' || show === 'email') && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600">📧 Email</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Tile label="Active cohorts" value={d?.email.activeCohorts} />
            <Tile label="Emails sent" value={d?.email.sent} />
            <Tile label="Delivered" value={d?.email.delivered} />
            <Tile label="Delivery rate" value={d?.email.deliveryRate} suffix="%" />
            <Tile label="Replies" value={d?.email.replies} />
            <Tile label="Reply rate" value={d?.email.replyRate} suffix="%" />
            <Tile label="Forwarded" value={d?.email.forwarded} />
            <Tile label="Forward rate" value={d?.email.forwardRate} suffix="%" />
            <Tile label="Opens" value={d?.email.opens} hint="unique opens" />
            <Tile label="Open rate" value={d?.email.openRate} suffix="%" />
            <Tile label="Clicks" value={d?.email.clicks} hint="link clicks" />
            <Tile label="Click rate" value={d?.email.clickRate} suffix="%" />
            <Tile label="Total campaigns" value={d?.email.totalCampaigns} />
          </div>
        </section>
      )}

      {(show === 'both' || show === 'linkedin') && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600">🔗 LinkedIn</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Tile label="Accounts connected" value={d?.linkedin.accountsConnected} />
            <Tile label="Invites sent" value={d?.linkedin.invitesSent} />
            <Tile label="Connected" value={d?.linkedin.connected} />
            <Tile label="Acceptance rate" value={d?.linkedin.acceptanceRate} suffix="%" />
            <Tile label="Replies" value={d?.linkedin.replies} />
            <Tile label="Reply rate" value={d?.linkedin.replyRate} suffix="%" />
            <Tile label="Total leads" value={d?.linkedin.totalLeads} />
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, suffix, hint }: { label: string; value?: number | string; suffix?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" title={hint}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">
        {value == null ? '—' : `${value}${suffix ?? ''}`}
      </div>
    </div>
  );
}
