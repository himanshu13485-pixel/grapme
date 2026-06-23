'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge } from '@/components/ui';

interface Step {
  id: string;
  stepOrder: number;
  waitDays: number;
  condition: string;
}
interface Campaign {
  id: string;
  name: string;
  status: string;
  clientLabel?: string;
  timezone: string;
  dailyLimit: number;
  sendSpeedSeconds: number;
  steps: Step[];
}
interface Analytics {
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');

  const load = useCallback(() => {
    api.get<Campaign>(`/campaigns/${id}`).then(setCampaign).catch(() => {});
    api.get<Analytics>(`/campaigns/${id}/analytics`).then(setAnalytics).catch(() => {});
  }, [id]);

  useEffect(() => load(), [load]);

  async function act(path: string, body?: unknown) {
    setError('');
    try {
      await api.post(`/campaigns/${id}/${path}`, body);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  if (!campaign)
    return <div className="text-slate-400">Loading campaign…</div>;

  const editable = ['DRAFT', 'REJECTED'].includes(campaign.status);

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={campaign.clientLabel}
        action={<StatusBadge status={campaign.status} />}
      />

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-3">
        {editable && (
          <button className="btn-primary" onClick={() => act('submit')}>
            Submit for approval
          </button>
        )}
        {campaign.status === 'APPROVED' && (
          <div className="flex items-end gap-2">
            <div>
              <label className="label">Schedule at</label>
              <input
                type="datetime-local"
                className="input"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            </div>
            <button
              className="btn-primary"
              onClick={() =>
                act('schedule', { scheduledAt: new Date(scheduleAt).toISOString() })
              }
            >
              Schedule
            </button>
          </div>
        )}
        {campaign.status === 'RUNNING' && (
          <button className="btn-ghost" onClick={() => act('pause')}>
            Pause
          </button>
        )}
        {campaign.status === 'PAUSED' && (
          <button className="btn-primary" onClick={() => act('resume')}>
            Resume
          </button>
        )}
      </div>

      {/* Analytics */}
      <div className="mb-6 grid grid-cols-3 gap-4 lg:grid-cols-6">
        {[
          ['Sent', analytics?.sent ?? 0],
          ['Opens', analytics?.opens ?? 0],
          ['Clicks', analytics?.clicks ?? 0],
          ['Replies', analytics?.replies ?? 0],
          ['Open %', analytics?.openRate ?? 0],
          ['Reply %', analytics?.replyRate ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {/* Config + steps */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="mb-4 font-medium">Sending configuration</h3>
          <dl className="space-y-2 text-sm">
            <Row k="Timezone" v={campaign.timezone} />
            <Row k="Daily limit" v={String(campaign.dailyLimit)} />
            <Row k="Send speed" v={`${campaign.sendSpeedSeconds}s between sends`} />
          </dl>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-medium">Follow-up sequence</h3>
            {editable && (
              <button
                className="text-sm text-brand-600 hover:underline"
                onClick={() =>
                  act('steps', {
                    stepOrder: campaign.steps.length + 1,
                    waitDays: 3,
                    condition: 'NO_REPLY',
                  })
                }
              >
                + Add step
              </button>
            )}
          </div>
          {campaign.steps.length === 0 ? (
            <p className="text-sm text-slate-400">
              No follow-ups. The initial email sends on schedule.
            </p>
          ) : (
            <ol className="space-y-2">
              {campaign.steps.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                >
                  <span>Step {s.stepOrder}</span>
                  <span className="text-slate-500">
                    wait {s.waitDays}d · {s.condition}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
