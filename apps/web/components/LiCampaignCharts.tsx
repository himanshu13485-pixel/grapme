'use client';

import { useState } from 'react';
import { LiCampaignDay } from '@/lib/linkedin';

const VIOLET = '#8b5cf6';
const EMERALD = '#10b981';
const SLATE = '#94a3b8';
const BLUE = '#3b82f6';

function fmtDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function niceMax(m: number) { return Math.max(5, Math.ceil(m / 5) * 5); }

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-3 flex justify-center gap-5 text-xs text-slate-500">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />{it.label}
        </span>
      ))}
    </div>
  );
}

/** Area chart: connection invitations Sent vs Accepted over the last 30 days. */
export function ConnectionPerformanceChart({ series }: { series: LiCampaignDay[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 740, H = 260, padL = 34, padR = 14, padT = 18, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = series.length;
  const hasData = series.some((d) => d.sent || d.accepted);
  const nice = niceMax(Math.max(...series.map((d) => Math.max(d.sent, d.accepted)), 0));

  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (v / nice) * ih;
  const line = (k: 'sent' | 'accepted') => series.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const area = (k: 'sent' | 'accepted') => `${line(k)} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f));
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-slate-800">Connection Performance</h3>
      <p className="mb-3 text-sm text-slate-400">Sent vs Accepted invitations</p>
      {!hasData ? (
        <div className="grid h-52 place-items-center text-sm text-slate-400">No connection activity yet.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHi(null)}>
          <defs>
            <linearGradient id="cpSent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={VIOLET} stopOpacity="0.28" /><stop offset="100%" stopColor={VIOLET} stopOpacity="0.02" /></linearGradient>
            <linearGradient id="cpAcc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={EMERALD} stopOpacity="0.28" /><stop offset="100%" stopColor={EMERALD} stopOpacity="0.02" /></linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{t}</text>
            </g>
          ))}
          <path d={area('sent')} fill="url(#cpSent)" />
          <path d={area('accepted')} fill="url(#cpAcc)" />
          <path d={line('sent')} fill="none" stroke={VIOLET} strokeWidth="2" />
          <path d={line('accepted')} fill="none" stroke={EMERALD} strokeWidth="2" />
          {series.map((d, i) => i % labelEvery === 0 && (
            <text key={d.date} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#94a3b8">{fmtDay(d.date)}</text>
          ))}
          {hi !== null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + ih} stroke="#cbd5e1" />
              <circle cx={x(hi)} cy={y(series[hi].sent)} r="3.5" fill={VIOLET} />
              <circle cx={x(hi)} cy={y(series[hi].accepted)} r="3.5" fill={EMERALD} />
              <g transform={`translate(${x(hi) > W - 130 ? x(hi) - 120 : x(hi) + 10}, ${padT + 4})`}>
                <rect width="112" height="58" rx="8" fill="#fff" stroke="#e2e8f0" />
                <text x="10" y="18" fontSize="11" fontWeight="600" fill="#334155">{fmtDay(series[hi].date)}</text>
                <text x="10" y="34" fontSize="11" fill={VIOLET}>Sent : {series[hi].sent}</text>
                <text x="10" y="50" fontSize="11" fill={EMERALD}>Accepted : {series[hi].accepted}</text>
              </g>
            </g>
          )}
          {series.map((d, i) => (
            <rect key={d.date} x={x(i) - iw / n / 2} y={padT} width={iw / n} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
      )}
      <Legend items={[{ color: VIOLET, label: 'Sent' }, { color: EMERALD, label: 'Accepted' }]} />
    </div>
  );
}

/** Grouped bars: messages sent vs replies received over the last 30 days. */
export function EngagementVolumeChart({ series }: { series: LiCampaignDay[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 740, H = 260, padL = 30, padR = 14, padT = 18, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = series.length;
  const hasData = series.some((d) => d.messages || d.replies);
  const nice = niceMax(Math.max(...series.map((d) => Math.max(d.messages, d.replies)), 0));
  const y = (v: number) => padT + ih - (v / nice) * ih;
  const group = iw / n;
  const bw = Math.max(2, group / 2 - 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f));
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-slate-800">Engagement Volume</h3>
      <p className="mb-3 text-sm text-slate-400">Messages vs Replies</p>
      {!hasData ? (
        <div className="grid h-52 place-items-center text-sm text-slate-400">No messages sent yet.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHi(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{t}</text>
            </g>
          ))}
          {series.map((d, i) => {
            const gx = padL + i * group;
            return (
              <g key={d.date} onMouseEnter={() => setHi(i)}>
                <rect x={gx} y={padT} width={group} height={ih} fill={hi === i ? '#f1f5f9' : 'transparent'} />
                <rect x={gx + group / 2 - bw - 0.5} y={y(d.messages)} width={bw} height={padT + ih - y(d.messages)} rx="1.5" fill={SLATE} />
                <rect x={gx + group / 2 + 0.5} y={y(d.replies)} width={bw} height={padT + ih - y(d.replies)} rx="1.5" fill={BLUE} />
              </g>
            );
          })}
          {series.map((d, i) => i % labelEvery === 0 && (
            <text key={d.date} x={padL + i * group + group / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="#94a3b8">{fmtDay(d.date)}</text>
          ))}
          {hi !== null && (
            <g transform={`translate(${padL + hi * group + group / 2 > W - 130 ? padL + hi * group + group / 2 - 120 : padL + hi * group + group / 2 + 8}, ${padT + 4})`}>
              <rect width="116" height="58" rx="8" fill="#fff" stroke="#e2e8f0" />
              <text x="10" y="18" fontSize="11" fontWeight="600" fill="#334155">{fmtDay(series[hi].date)}</text>
              <text x="10" y="34" fontSize="11" fill={SLATE}>Messages : {series[hi].messages}</text>
              <text x="10" y="50" fontSize="11" fill={BLUE}>Replies : {series[hi].replies}</text>
            </g>
          )}
        </svg>
      )}
      <Legend items={[{ color: SLATE, label: 'Messages' }, { color: BLUE, label: 'Replies' }]} />
    </div>
  );
}
