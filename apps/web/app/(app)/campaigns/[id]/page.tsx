'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { PageHeader, StatusBadge } from '@/components/ui';
import { WorldMap, GeoData } from '@/components/WorldMap';

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
  delivered: number;
  deliveryRate: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  unsubscribes: number;
  forwarded: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  forwardRate: number;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [error, setError] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [period, setPeriod] = useState('lifetime');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    api.get<Campaign>(`/campaigns/${id}`).then(setCampaign).catch(() => {});
    api.get<GeoData>(`/campaigns/${id}/geo`).then(setGeo).catch(() => {});
  }, [id]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (period === 'custom' && (!from || !to)) return;
    const qs = new URLSearchParams({ period });
    if (period === 'custom') { qs.set('from', from); qs.set('to', to); }
    api.get<Analytics>(`/campaigns/${id}/analytics?${qs}`).then(setAnalytics).catch(() => {});
  }, [id, period, from, to]);

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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {[['week', 'Week'], ['month', 'Month'], ['lifetime', 'Lifetime'], ['custom', 'Custom']].map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={`rounded-md px-3 py-1 font-medium transition ${period === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              {l}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <span className="flex items-center gap-1 text-sm">
            <input type="date" className="input py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400">→</span>
            <input type="date" className="input py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Campaign report</h3>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            const a = analytics;
            const headers = [
              'Campaign', 'Sent', 'Delivered', 'Delivery %', 'Opens', 'Open %',
              'Clicks', 'Click %', 'Replies', 'Reply %', 'Forwarded', 'Forward %',
              'Bounces', 'Bounce %', 'Unsub',
            ];
            const row = [
              campaign.name, a?.sent ?? 0, a?.delivered ?? 0, a?.deliveryRate ?? 0,
              a?.opens ?? 0, a?.openRate ?? 0, a?.clicks ?? 0, a?.clickRate ?? 0,
              a?.replies ?? 0, a?.replyRate ?? 0, a?.forwarded ?? 0, a?.forwardRate ?? 0,
              a?.bounces ?? 0, a?.bounceRate ?? 0, a?.unsubscribes ?? 0,
            ];
            const safe = campaign.name.replace(/[^\w-]+/g, '_');
            downloadCsv(`${safe}_campaign_report`, headers, [row]);
          }}
        >
          ⭳ Export CSV
        </button>
      </div>
      <div className="mb-6 grid grid-cols-3 gap-4 lg:grid-cols-6">
        {([
          ['Sent', analytics?.sent ?? 0],
          ['Delivered', analytics?.delivered ?? 0],
          ['Delivery %', `${analytics?.deliveryRate ?? 0}%`],
          ['Opens', analytics?.opens ?? 0],
          ['Open %', `${analytics?.openRate ?? 0}%`],
          ['Clicks', analytics?.clicks ?? 0],
          ['Click %', `${analytics?.clickRate ?? 0}%`],
          ['Replies', analytics?.replies ?? 0],
          ['Reply %', `${analytics?.replyRate ?? 0}%`],
          ['Forwarded', analytics?.forwarded ?? 0],
          ['Forward %', `${analytics?.forwardRate ?? 0}%`],
          ['Bounces', analytics?.bounces ?? 0],
          ['Bounce %', `${analytics?.bounceRate ?? 0}%`],
          ['Unsub', analytics?.unsubscribes ?? 0],
        ] as [string, string | number][]).map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {geo && (
        <div className="mb-6">
          <WorldMap geo={geo} title="Geographic engagement" />
        </div>
      )}

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
