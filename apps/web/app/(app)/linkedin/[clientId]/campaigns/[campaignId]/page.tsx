'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge } from '@/components/ui';
import { LiCampaignDetailView } from '@/components/LiCampaignDetailView';
import { LiCampaignDetail } from '@/lib/linkedin';

export default function LiCampaignDetailPage() {
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId: string }>();
  const [c, setC] = useState<LiCampaignDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<LiCampaignDetail>(`/linkedin/campaigns/${campaignId}`).then(setC).catch(() => {});
  }, [campaignId]);
  useEffect(() => { load(); }, [load]);

  if (!c) return <EmptyState message="Loading…" />;

  const running = c.status === 'RUNNING';
  async function toggle() {
    setBusy(true);
    try { await api.post(`/linkedin/campaigns/${campaignId}/${running ? 'pause' : 'resume'}`); load(); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <Link href={`/linkedin/${clientId}?tab=campaigns`} className="text-sm text-slate-500 hover:text-slate-800">← Back to campaigns</Link>
      <PageHeader
        title={c.name}
        subtitle={`${c.linkedInAccount?.fullName ?? ''} · ${c.timezone} · ${c.outreachType === 'DIRECT_MESSAGES' ? 'Direct Messages' : 'With Connection'}`}
        action={
          <div className="flex items-center gap-3">
            {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
            <StatusBadge status={c.status} />
            <button className={running ? 'btn-ghost' : 'btn-primary'} disabled={busy || c.status === 'ARCHIVED'} onClick={toggle}>
              {running ? '⏸ Pause' : '▶ Start'}
            </button>
          </div>
        }
      />

      <LiCampaignDetailView campaignId={campaignId} base="/linkedin" />
    </div>
  );
}
