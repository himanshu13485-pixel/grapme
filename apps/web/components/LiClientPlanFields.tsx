'use client';

import { LiCampaignDefaults, LI_DEFAULTS } from '@/lib/linkedin';

export interface LiPlanForm {
  seats: number;
  defaults: Required<LiCampaignDefaults>;
}

export function emptyLiPlan(): LiPlanForm {
  return { seats: 1, defaults: { ...LI_DEFAULTS } };
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Seats</label>
          <select className="input" value={value.seats} onChange={(e) => onChange({ ...value, seats: Number(e.target.value) })}>
            {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Send window */}
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Send window</div>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Start hour (0–23)</label><input className="input" type="number" min={0} max={23} value={d.workStartHour} onChange={(e) => setD({ workStartHour: Number(e.target.value) })} /></div>
        <div><label className="label">End hour (0–23)</label><input className="input" type="number" min={1} max={23} value={d.workEndHour} onChange={(e) => setD({ workEndHour: Number(e.target.value) })} /></div>
      </div>

      {/* Daily caps */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Max connection invites / day</label><input className="input" type="number" min={1} max={200} value={d.dailyConnectionLimit} onChange={(e) => setD({ dailyConnectionLimit: Number(e.target.value) })} /></div>
        <div><label className="label">Max messages / day</label><input className="input" type="number" min={1} max={200} value={d.dailyMessageLimit} onChange={(e) => setD({ dailyMessageLimit: Number(e.target.value) })} /></div>
      </div>

      {/* Warm-up ramp */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Start invites / day</label><input className="input" type="number" min={1} value={d.warmupStartLimit} onChange={(e) => setD({ warmupStartLimit: Number(e.target.value) })} /></div>
        <div><label className="label">Days to reach full cap</label><input className="input" type="number" min={1} max={60} value={d.warmupDays} onChange={(e) => setD({ warmupDays: Number(e.target.value) })} /></div>
      </div>

      {/* Drip (admin-only) */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" checked={d.dripEnabled} onChange={(e) => setD({ dripEnabled: e.target.checked })} />
          Auto Lead Sourcing (Drip) <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Admin</span>
        </label>
        <p className="mt-1 text-xs text-slate-500">Auto-refill the audience from LinkedIn search when pending leads run low.</p>
      </div>
    </div>
  );
}
