'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge } from '@/components/ui';
import { LiCampaignDetailView } from '@/components/LiCampaignDetailView';
import { LiCampaignDetail, LinkedInAccount } from '@/lib/linkedin';

export default function LiCampaignDetailPage() {
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId: string }>();
  const [c, setC] = useState<LiCampaignDetail | null>(null);
  const [busy, setBusy] = useState(false);
  // For re-attaching an account when this campaign's original one was removed.
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => {
    api.get<LinkedInAccount[]>(`/linkedin/clients/${clientId}/linkedin-accounts`).then(setAccounts).catch(() => {});
  }, [clientId]);

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

  async function attach() {
    if (!pick) return;
    setBusy(true);
    try { await api.post(`/linkedin/campaigns/${campaignId}/account`, { linkedInAccountId: pick }); setPick(''); load(); }
    catch (e: any) { alert(e?.message ?? 'Could not attach the account'); }
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
            <button
              className={running ? 'btn-ghost' : 'btn-primary'}
              disabled={busy || c.status === 'ARCHIVED' || (!running && !c.linkedInAccountId)}
              title={!running && !c.linkedInAccountId ? 'Attach a LinkedIn account first' : undefined}
              onClick={toggle}
            >
              {running ? '⏸ Pause' : '▶ Start'}
            </button>
          </div>
        }
      />

      {/* The engine can pause a campaign on its own (low acceptance rate, or the seat
          tripping a LinkedIn checkpoint). Say why, or the stop looks like a bug. */}
      {/* Account removed: the campaign kept its sequence, audience and leads, and can be
          pointed at another account to carry on from where it stopped. */}
      {!c.linkedInAccountId && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <div className="font-medium">No LinkedIn account attached.</div>
          <p className="mt-0.5 text-rose-800">
            This campaign&apos;s account was removed. Its sequence, audience and leads are kept — attach an account, then Start to carry on.
          </p>
          {accounts.length === 0 ? (
            <p className="mt-2 text-rose-800">Connect an account on this client&apos;s Accounts tab first.</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="rounded border border-rose-200 bg-white px-2 py-1 text-sm"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Choose an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.fullName ?? 'Pending connection'} · {a.status}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={!pick || busy} onClick={() => void attach()}>Attach</button>
            </div>
          )}
        </div>
      )}

      {c.status === 'PAUSED' && c.pausedReason && c.linkedInAccountId && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">Paused automatically. </span>
          {c.pausedReason}
        </div>
      )}

      <LiCampaignDetailView campaignId={campaignId} base="/linkedin" />
    </div>
  );
}
