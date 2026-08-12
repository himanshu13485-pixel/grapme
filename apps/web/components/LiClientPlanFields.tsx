'use client';

import { LiCampaignDefaults, LI_DEFAULTS } from '@/lib/linkedin';

export interface LiPlanForm {
  seats: number;
  credits: number;        // subscription.creditsBalance
  campaignLimit: number;  // max LinkedIn campaigns (0 = unlimited)
  defaults: Required<LiCampaignDefaults>;
}

export function emptyLiPlan(): LiPlanForm {
  // Prefilled business-requirement defaults for a new client (admin can still edit).
  return {
    seats: 1,
    credits: 4000,
    campaignLimit: 0,
    defaults: {
      ...LI_DEFAULTS,
      workStartHour: 9, workEndHour: 18, workDays: [1, 2, 3, 4, 5],
      dailyConnectionLimit: 15, dailyMessageLimit: 30,
      jitterMinSeconds: 300, jitterMaxSeconds: 600,
      warmupEnabled: true, warmupStartLimit: 5, warmupDays: 28,
    },
  };
}

const DAYS = [
  { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' },
  { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' },
];

/** Basic LinkedIn send window a client sets at self-service setup. No warm-up,
 *  drip, seats or credit metering — those stay admin-only and secret. */
export function LiClientSendWindowFields({ value, onChange }: { value: LiPlanForm; onChange: (v: LiPlanForm) => void }) {
  const d = value.defaults;
  const setD = (patch: Partial<LiCampaignDefaults>) => onChange({ ...value, defaults: { ...value.defaults, ...patch } });
  const toggleDay = (day: number) => {
    const has = d.workDays.includes(day);
    setD({ workDays: has ? d.workDays.filter((x) => x !== day) : [...d.workDays, day].sort() });
  };
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">🔗</span>
        <h4 className="font-semibold text-slate-800">LinkedIn send window</h4>
      </div>
      <p className="mb-3 text-xs text-slate-500">When should LinkedIn outreach run? Your account team fine-tunes limits and warm-up.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Start hour (0–23)</label><input className="input" type="number" min={0} max={23} value={d.workStartHour} onChange={(e) => setD({ workStartHour: Number(e.target.value) })} /></div>
        <div><label className="label">End hour (0–23)</label><input className="input" type="number" min={1} max={23} value={d.workEndHour} onChange={(e) => setD({ workEndHour: Number(e.target.value) })} /></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DAYS.map((day) => (
          <button key={day.v} type="button" onClick={() => toggleDay(day.v)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${d.workDays.includes(day.v) ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
            {day.l}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Max connection invites / day</label><input className="input" type="number" min={1} max={200} value={d.dailyConnectionLimit} onChange={(e) => setD({ dailyConnectionLimit: Number(e.target.value) })} /></div>
        <div><label className="label">Max messages / day</label><input className="input" type="number" min={1} max={200} value={d.dailyMessageLimit} onChange={(e) => setD({ dailyMessageLimit: Number(e.target.value) })} /></div>
      </div>
    </div>
  );
}

/**
 * LinkedIn business requirements for the New/Edit Client form (admin-only), shown
 * only when the client is subscribed to LinkedIn. These become the client's sending
 * defaults, inherited by every new campaign. Plan name, timezone and WhatsApp are
 * shared with the email plan and live in the form's common section — not here.
 * Fields not surfaced (run 24/7, weekdays, drip volume) keep sensible defaults.
 */
export function LiClientPlanFields({
  value, onChange, creditMetering, onCreditMetering,
}: {
  value: LiPlanForm;
  onChange: (v: LiPlanForm) => void;
  creditMetering: boolean;
  onCreditMetering: (v: boolean) => void;
}) {
  const d = value.defaults;
  const setD = (patch: Partial<LiCampaignDefaults>) => onChange({ ...value, defaults: { ...value.defaults, ...patch } });
  const toggleDay = (day: number) => {
    const has = d.workDays.includes(day);
    setD({ workDays: has ? d.workDays.filter((x) => x !== day) : [...d.workDays, day].sort() });
  };
  // Effective pace = send-window length ÷ daily cap (how the scheduler spreads sends).
  const windowHours = value.defaults.run247 ? 24 : Math.max(1, (d.workEndHour ?? 18) - (d.workStartHour ?? 9));
  const paceMin = (cap?: number) => (cap && cap > 0 ? Math.max(1, Math.round((windowHours * 60) / cap)) : null);

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">🔗</span>
        <h4 className="font-semibold text-slate-800">LinkedIn business requirements</h4>
        <span className="ml-auto text-[11px] text-slate-400">Defaults for every new LinkedIn campaign · editable per campaign</span>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={creditMetering} onChange={(e) => onCreditMetering(e.target.checked)} />
        Charge <strong>1 credit</strong> per LinkedIn lead-sourcing run (leave off to source free)
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Seats</label>
          <select className="input" value={value.seats} onChange={(e) => onChange({ ...value, seats: Number(e.target.value) })}>
            {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div><label className="label">Credits</label><input className="input" type="number" min={0} value={value.credits} onChange={(e) => onChange({ ...value, credits: Math.max(0, Number(e.target.value) || 0) })} /></div>
        <div><label className="label">Campaigns (0=∞)</label><input className="input" type="number" min={0} value={value.campaignLimit} onChange={(e) => onChange({ ...value, campaignLimit: Math.max(0, Number(e.target.value) || 0) })} /></div>
      </div>

      {/* Send window */}
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Send window</div>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Start hour (0–23)</label><input className="input" type="number" min={0} max={23} value={d.workStartHour} onChange={(e) => setD({ workStartHour: Number(e.target.value) })} /></div>
        <div><label className="label">End hour (0–23)</label><input className="input" type="number" min={1} max={23} value={d.workEndHour} onChange={(e) => setD({ workEndHour: Number(e.target.value) })} /></div>
      </div>
      {/* Send days */}
      <div className="mt-3"><label className="label">Send days</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button key={day.v} type="button" onClick={() => toggleDay(day.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${d.workDays.includes(day.v) ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
              {day.l}
            </button>
          ))}
        </div>
      </div>

      {/* Daily caps */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Max connection invites / day</label><input className="input" type="number" min={1} max={200} value={d.dailyConnectionLimit} onChange={(e) => setD({ dailyConnectionLimit: Number(e.target.value) })} /></div>
        <div><label className="label">Max messages / day</label><input className="input" type="number" min={1} max={200} value={d.dailyMessageLimit} onChange={(e) => setD({ dailyMessageLimit: Number(e.target.value) })} /></div>
      </div>
      <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-500">
        ⏱ Effective pace over a {windowHours}h window: {paceMin(d.dailyConnectionLimit) ? `~1 invite every ${paceMin(d.dailyConnectionLimit)} min` : '—'} · {paceMin(d.dailyMessageLimit) ? `~1 message every ${paceMin(d.dailyMessageLimit)} min` : '—'}
      </div>

      {/* Send pacing — the daily cap is spread evenly across the window; wobble adds a random ± nudge */}
      <div className="mt-4 text-xs text-slate-500">Actions are spread evenly across the send window (e.g. 20/day over 9 h ≈ one every ~27 min). The wobble adds a random ± nudge to each slot so it isn’t clockwork.</div>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Wobble min (sec)</label><input className="input" type="number" min={0} max={3600} value={d.jitterMinSeconds} onChange={(e) => setD({ jitterMinSeconds: Number(e.target.value) })} /></div>
        <div><label className="label">Wobble max (sec)</label><input className="input" type="number" min={1} max={3600} value={d.jitterMaxSeconds} onChange={(e) => setD({ jitterMaxSeconds: Number(e.target.value) })} /></div>
      </div>

      {/* Warm-up ramp */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Start invites / day</label><input className="input" type="number" min={1} value={d.warmupStartLimit} onChange={(e) => setD({ warmupStartLimit: Number(e.target.value) })} /></div>
        <div><label className="label">Days to reach full cap</label><input className="input" type="number" min={1} max={60} value={d.warmupDays} onChange={(e) => setD({ warmupDays: Number(e.target.value) })} /></div>
      </div>
      {(() => {
        const full = Math.max(1, d.dailyConnectionLimit);
        const start = Math.min(Math.max(1, d.warmupStartLimit), full);
        const days = Math.max(1, d.warmupDays);
        const mid = Math.max(1, Math.round(days / 2));
        const capOn = (day: number) => Math.max(start, Math.min(full, Math.round(start + (full - start) * (day / days))));
        return (
          <div className="mt-1 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-500">
            📈 Warm-up climbs gradually (not flat): <strong>Day 1 ≈ {start}/day</strong> → Day {mid} ≈ {capOn(mid)}/day → <strong>Day {days} = {full}/day</strong>, then holds. The wobble still spaces each day’s invites.
          </div>
        );
      })()}

      {/* Drip (admin-only) */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" checked={d.dripEnabled} onChange={(e) => setD({ dripEnabled: e.target.checked })} />
          Auto Lead Sourcing (Drip) <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Admin</span>
        </label>
        <p className="mt-1 text-xs text-slate-500">Auto-refill the audience from LinkedIn search when pending leads run low.</p>
        {d.dripEnabled && (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label">Leads sourced / day</label><input className="input" type="number" min={1} max={200} value={d.dripDailyTarget} onChange={(e) => setD({ dripDailyTarget: Number(e.target.value) })} /></div>
              <div><label className="label">Refill when pending below</label><input className="input" type="number" min={1} max={1000} value={d.dripBuffer} onChange={(e) => setD({ dripBuffer: Number(e.target.value) })} /></div>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Refills only when pending leads drop below {d.dripBuffer}, sourcing up to {d.dripDailyTarget}/day.
              {creditMetering ? ' Credit metering is on — that’s 1 credit per refill.' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
