'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Figures {
  sent: number;
  replies: number;
  replyRate: number;
}

interface ReplyBoost {
  enabled: boolean;
  minPct: number;
  maxPct: number;
  actual: Figures;
  shown: Figures;
}

/**
 * Reply presentation band — main admin only. Sets the range the Replies figure
 * on staff dashboards moves within. The real numbers are shown here, and are
 * what the client portal and every report always use.
 */
export function ReplyBoostCard() {
  const [data, setData] = useState<ReplyBoost | null>(null);
  const [min, setMin] = useState('5.5');
  const [max, setMax] = useState('7.5');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function apply(d: ReplyBoost) {
    setData(d);
    setMin(String(d.minPct));
    setMax(String(d.maxPct));
  }

  useEffect(() => {
    api.get<ReplyBoost>('/reply-boost').then(apply).catch(() => {});
  }, []);

  async function save(next: Partial<{ enabled: boolean; minPct: number; maxPct: number }>) {
    setBusy(true);
    setMsg('');
    try {
      apply(await api.patch<ReplyBoost>('/reply-boost', next));
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Reply rate shown on dashboards</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sets the range the Replies figure moves within on the dashboards of admins, sub-admins
            and salespeople. It drifts slowly inside the range and never jumps on refresh. The
            client portal and every report always show the real numbers.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={busy}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-32">
          <label className="label">Lowest rate (%)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </div>
        <div className="w-32">
          <label className="label">Highest rate (%)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => save({ minPct: Number(min), maxPct: Number(max) })}
        >
          {busy ? 'Saving…' : 'Save range'}
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Actual</div>
          <div className="mt-1 text-sm text-slate-700">
            {data.actual.replies} replies · {data.actual.replyRate}% of {data.actual.sent} sent
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Shown on dashboards
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {data.enabled ? (
              <>
                {data.shown.replies} replies · {data.shown.replyRate}%
              </>
            ) : (
              <span className="text-slate-500">Off — dashboards show the actual figures</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
