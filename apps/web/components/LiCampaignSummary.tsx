'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LiCampaignDetail } from '@/lib/linkedin';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function hourLabel(h: number): string {
  const ap = h < 12 ? 'AM' : 'PM';
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${ap}`;
}

/** Read-only view of a campaign's configured selections (audience, messages, schedule, seat). */
export function LiCampaignSummary({ campaignId, base = '/linkedin' }: { campaignId: string; base?: string }) {
  const [c, setC] = useState<LiCampaignDetail | null>(null);
  const isPortal = base.includes('/portal');

  useEffect(() => {
    api.get<LiCampaignDetail>(`${base}/campaigns/${campaignId}`).then(setC).catch(() => {});
  }, [campaignId, base]);

  if (!c) return <div className="text-sm text-slate-400">Loading…</div>;
  const a = (c.audienceSpec ?? {}) as Record<string, string[]>;
  const chips = (arr?: string[]) =>
    arr && arr.length
      ? arr.map((x) => <span key={x} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{x}</span>)
      : <span className="text-xs text-slate-400">Not specified</span>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Target Audience">
        <Field label="LinkedIn seat"><span className="text-sm font-medium text-slate-700">{c.linkedInAccount?.fullName ?? '—'}</span></Field>
        <Field label="Countries">{chips(a.countries)}</Field>
        <Field label="Cities">{chips(a.cities)}</Field>
        <Field label="Industries">{chips(a.industries)}</Field>
        <Field label="Company sizes">{chips(a.companySizes)}</Field>
        <Field label="Departments">{chips(a.departments)}</Field>
        <Field label="Job titles">{chips(a.jobTitles)}</Field>
        <Field label="Seniorities">{chips(a.seniorities)}</Field>
        <Field label="Person keywords">{chips(a.personKeywordsInclude)}</Field>
      </Section>

      <div className="space-y-4">
        <Section title={`Messages (${c.steps?.length ?? 0})`}>
          <ol className="space-y-2">
            {(c.steps ?? []).map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-100 p-2 text-sm">
                <div className="font-medium text-slate-700">
                  {s.type === 'CONNECTION_REQUEST' ? 'Connection request' : 'Message'}
                  {s.waitHours > 0 && <span className="font-normal text-slate-400"> · wait {s.waitHours}h</span>}
                </div>
                <div className="line-clamp-3 text-slate-500">{s.body || s.note || <span className="italic text-slate-300">no text</span>}</div>
              </li>
            ))}
            {(c.steps ?? []).length === 0 && <li className="text-xs text-slate-400">No messages set.</li>}
          </ol>
        </Section>

        <Section title="Schedule & Limits">
          <Field label="Type"><span className="text-sm text-slate-700">{c.outreachType === 'DIRECT_MESSAGES' ? 'Direct Messages' : 'With Connection'}</span></Field>
          <Field label="Send window">
            <span className="text-sm text-slate-700">
              {c.run247 ? '24/7' : `${hourLabel(c.workStartHour ?? 9)}–${hourLabel(c.workEndHour ?? 18)} · ${(c.workDays ?? []).map((d) => DAY[d]).join(', ')}`}
            </span>
          </Field>
          <Field label="Daily limits"><span className="text-sm text-slate-700">{c.dailyConnectionLimit} connects · {c.dailyMessageLimit} messages</span></Field>
          <Field label="Warm-up"><span className="text-sm text-slate-700">{c.warmupEnabled ? `${c.warmupStartLimit}/day → ${c.dailyConnectionLimit}/day over ${c.warmupDays} days` : 'Off'}</span></Field>
          {!isPortal && (
            <Field label="Auto-source (drip)"><span className="text-sm text-slate-700">{c.dripEnabled ? `up to ${c.dripDailyTarget}/day · buffer ${c.dripBuffer}` : 'Off'}</span></Field>
          )}
          <Field label="Timezone"><span className="text-sm text-slate-700">{c.timezone}</span></Field>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-800">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex max-w-[70%] flex-wrap justify-end gap-1">{children}</div>
    </div>
  );
}
