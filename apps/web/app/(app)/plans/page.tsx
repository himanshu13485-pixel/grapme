'use client';

import { useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { usePlans, Plan, PlanPrice } from '@/lib/plans';
import { PageHeader } from '@/components/ui';

export default function MembershipPage() {
  const { plans, loading, reload } = usePlans();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/plans', { name: name.trim(), color });
      setName('');
      setColor('#0f766e');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, planName: string) {
    if (!confirm(`Delete membership "${planName}"?`)) return;
    try {
      await api.del(`/plans/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Membership"
        subtitle="Each membership plan's entitlements — validity, credits, mailboxes/seats and campaign limits for Email and LinkedIn"
      />

      <form onSubmit={add} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="label">New membership name</label>
          <input
            className="input"
            placeholder="e.g. Starter, Pro, Elite…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Theme colour</label>
          <input
            type="color"
            className="h-10 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div className="card divide-y divide-slate-100">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No memberships yet.</div>
        ) : (
          plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={reload} onDelete={remove} />)
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        A membership can only be deleted when no client is using it. Changing a colour
        re-themes the portal for every client on that membership.
      </p>
    </div>
  );
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);

function PlanRow({
  plan,
  onSaved,
  onDelete,
}: {
  plan: Plan;
  onSaved: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [color, setColor] = useState(plan.color);
  const [emailOn, setEmailOn] = useState(plan.emailEnabled !== false);
  const [linkedInOn, setLinkedInOn] = useState(plan.linkedInEnabled !== false);
  const [form, setForm] = useState({
    sortOrder: num(plan.sortOrder),
    validityDays: plan.validityDays ?? 0,
    emailCredits: num(plan.emailCredits),
    linkedInCredits: num(plan.linkedInCredits),
    mailboxLimit: num(plan.mailboxLimit),
    seatLimit: num(plan.seatLimit),
    emailCampaignLimit: num(plan.emailCampaignLimit),
    linkedInCampaignLimit: num(plan.linkedInCampaignLimit),
  });
  const [pricing, setPricing] = useState<PlanPrice[]>(() => plan.pricing ?? []);
  const [cardStyle, setCardStyle] = useState<'entitlements' | 'features'>(
    plan.cardStyle === 'features' ? 'features' : 'entitlements',
  );
  const [features, setFeatures] = useState<string[]>(() => plan.features ?? []);
  const [popular, setPopular] = useState(!!plan.popular);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: number) => setForm((f) => ({ ...f, [k]: v }));
  // Per-period entitlements: base `form` = monthly; `yearly` holds the yearly overrides.
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [yearly, setYearly] = useState(() => {
    const ye = plan.yearlyEntitlements ?? {};
    return {
      validityDays: ye.validityDays ?? 0,
      emailCredits: ye.emailCredits ?? 0,
      linkedInCredits: ye.linkedInCredits ?? 0,
      mailboxLimit: ye.mailboxLimit ?? 0,
      seatLimit: ye.seatLimit ?? 0,
      emailCampaignLimit: ye.emailCampaignLimit ?? 0,
      linkedInCampaignLimit: ye.linkedInCampaignLimit ?? 0,
    };
  });
  const active = period === 'yearly' ? yearly : form;
  const setActive = (k: string, v: number) =>
    period === 'yearly'
      ? setYearly((y) => ({ ...y, [k]: v }))
      : set(k as keyof typeof form, v);
  const yeInit = (plan.yearlyEntitlements ?? {}) as Record<string, number>;
  const yearlyDirty = (['validityDays', 'emailCredits', 'linkedInCredits', 'mailboxLimit', 'seatLimit', 'emailCampaignLimit', 'linkedInCampaignLimit'] as const)
    .some((k) => (yearly[k] ?? 0) !== (yeInit[k] ?? 0));

  const setPrice = (i: number, k: keyof PlanPrice, v: string | number) =>
    setPricing((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: k === 'currency' ? String(v).toUpperCase() : Math.max(0, Number(v) || 0) } : r)));
  const addCurrency = (cur: string) => {
    if (!cur || pricing.some((p) => p.currency === cur)) return;
    setPricing((rows) => [...rows, { currency: cur, monthlyPrice: 0, monthlyBest: 0, yearlyPrice: 0, yearlyBest: 0 }]);
  };
  const removeCurrency = (i: number) => setPricing((rows) => rows.filter((_, j) => j !== i));

  const dirty =
    JSON.stringify(pricing) !== JSON.stringify(plan.pricing ?? []) ||
    cardStyle !== (plan.cardStyle === 'features' ? 'features' : 'entitlements') ||
    JSON.stringify(features) !== JSON.stringify(plan.features ?? []) ||
    popular !== !!plan.popular ||
    color.toLowerCase() !== plan.color.toLowerCase() ||
    emailOn !== (plan.emailEnabled !== false) ||
    linkedInOn !== (plan.linkedInEnabled !== false) ||
    form.sortOrder !== num(plan.sortOrder) ||
    form.validityDays !== (plan.validityDays ?? 0) ||
    form.emailCredits !== num(plan.emailCredits) ||
    form.linkedInCredits !== num(plan.linkedInCredits) ||
    form.mailboxLimit !== num(plan.mailboxLimit) ||
    form.seatLimit !== num(plan.seatLimit) ||
    form.emailCampaignLimit !== num(plan.emailCampaignLimit) ||
    form.linkedInCampaignLimit !== num(plan.linkedInCampaignLimit) ||
    yearlyDirty;

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/plans/${plan.id}`, {
        color,
        sortOrder: form.sortOrder,
        emailEnabled: emailOn,
        linkedInEnabled: linkedInOn,
        validityDays: form.validityDays > 0 ? form.validityDays : null,
        emailCredits: form.emailCredits,
        linkedInCredits: form.linkedInCredits,
        mailboxLimit: form.mailboxLimit,
        seatLimit: form.seatLimit,
        emailCampaignLimit: form.emailCampaignLimit,
        linkedInCampaignLimit: form.linkedInCampaignLimit,
        pricing,
        yearlyEntitlements: yearly,
        cardStyle,
        features: features.map((f) => f.trim()).filter(Boolean),
        popular,
      });
      onSaved();
    } catch {
      setColor(plan.color);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <label className="block text-[10px] font-medium uppercase text-slate-400">Serial</label>
            <input
              type="number" min={0}
              className="input w-16 py-1.5 text-center text-sm"
              value={form.sortOrder}
              onChange={(e) => set('sortOrder', Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <span
            className="h-8 w-8 rounded-lg border border-slate-200"
            style={{ background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 60%, black))` }}
          />
          <span className="text-base font-semibold text-slate-800">{plan.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500" title="Highlight this plan as “Most popular” on the pricing pages">
            <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} />
            ⭐ Popular
          </label>
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <button type="button" className="btn-primary px-3 py-1 text-xs disabled:opacity-40" onClick={save} disabled={busy || !dirty}>
            {busy ? '…' : 'Save'}
          </button>
          <button type="button" className="text-xs text-slate-400 hover:text-rose-600" onClick={() => onDelete(plan.id, plan.name)}>
            Delete
          </button>
        </div>
      </div>

      {/* Card style: entitlements breakdown vs a simple feature list */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Display as</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {([['entitlements', 'Entitlements'], ['features', 'Feature list']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setCardStyle(v)}
              className={`rounded px-2.5 py-0.5 font-medium transition ${cardStyle === v ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">
          {cardStyle === 'features' ? 'shows price + a “what’s included” list' : 'shows credits / mailboxes / seats / campaigns'}
        </span>
      </div>

      {cardStyle === 'entitlements' ? (
        <>
          <div className="mb-2">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Entitlements</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                {(['monthly', 'yearly'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPeriod(p)}
                    className={`rounded px-2.5 py-0.5 font-medium capitalize transition ${period === p ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>{p}</button>
                ))}
              </div>
              <span className="text-[11px] text-slate-400">values applied to a {period} subscription</span>
            </div>
            <NumField label="Validity (days)" value={active.validityDays} onChange={(v) => setActive('validityDays', v)} hint="0 = no expiry" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={`rounded-lg border p-3 transition ${emailOn ? 'border-brand-100 bg-brand-50/40' : 'border-slate-100 bg-slate-50/60'}`}>
              <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
                📧 Email {emailOn ? '' : '· off'}
              </label>
              <div className={`grid grid-cols-3 gap-2 ${emailOn ? '' : 'pointer-events-none opacity-40'}`}>
                <NumField label="Credits" value={active.emailCredits} onChange={(v) => setActive('emailCredits', v)} />
                <NumField label="Mailboxes" value={active.mailboxLimit} onChange={(v) => setActive('mailboxLimit', v)} />
                <NumField label="Campaigns" value={active.emailCampaignLimit} onChange={(v) => setActive('emailCampaignLimit', v)} />
              </div>
            </div>
            <div className={`rounded-lg border p-3 transition ${linkedInOn ? 'border-brand-100 bg-brand-50/40' : 'border-slate-100 bg-slate-50/60'}`}>
              <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <input type="checkbox" checked={linkedInOn} onChange={(e) => setLinkedInOn(e.target.checked)} />
                🔗 LinkedIn {linkedInOn ? '' : '· off'}
              </label>
              <div className={`grid grid-cols-3 gap-2 ${linkedInOn ? '' : 'pointer-events-none opacity-40'}`}>
                <NumField label="Credits" value={active.linkedInCredits} onChange={(v) => setActive('linkedInCredits', v)} />
                <NumField label="Seats" value={active.seatLimit} onChange={(v) => setActive('seatLimit', v)} />
                <NumField label="Campaigns" value={active.linkedInCampaignLimit} onChange={(v) => setActive('linkedInCampaignLimit', v)} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="max-w-xs">
            <NumField label="Validity (days)" value={form.validityDays} onChange={(v) => set('validityDays', v)} hint="0 = no expiry" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">What&apos;s included</label>
            <div className="space-y-2">
              {features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input py-1.5 text-sm"
                    placeholder="e.g. AI LinkedIn Outreach Platform"
                    value={f}
                    onChange={(e) => setFeatures((rows) => rows.map((r, j) => (j === i ? e.target.value : r)))}
                  />
                  <button type="button" className="text-xs text-slate-400 hover:text-rose-600" onClick={() => setFeatures((rows) => rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setFeatures((rows) => [...rows, ''])}>
                + Add feature
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-currency pricing */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">💳 Pricing <span className="font-normal normal-case text-slate-400">· taxes extra</span></div>
          <select
            className="input h-8 w-40 py-0 text-xs"
            value=""
            onChange={(e) => { addCurrency(e.target.value); e.target.value = ''; }}
          >
            <option value="">+ Add currency…</option>
            {CURRENCIES.filter((c) => !pricing.some((p) => p.currency === c)).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {pricing.length === 0 ? (
          <p className="text-xs text-slate-400">No pricing set — add a currency to enter monthly / yearly price and best price.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-1">Currency</th>
                  <th className="px-2 py-1" colSpan={2}>Monthly</th>
                  <th className="px-2 py-1" colSpan={2}>Yearly</th>
                  <th className="px-2 py-1"></th>
                </tr>
                <tr className="text-[10px] text-slate-300">
                  <th></th>
                  <th className="px-2 font-normal">Price</th><th className="px-2 font-normal">Best price</th>
                  <th className="px-2 font-normal">Price</th><th className="px-2 font-normal">Best price</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((p, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1"><input className="input w-20 py-1 text-center text-sm font-medium uppercase" value={p.currency} onChange={(e) => setPrice(i, 'currency', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} className="input w-24 py-1 text-sm" value={p.monthlyPrice} onChange={(e) => setPrice(i, 'monthlyPrice', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} className="input w-24 py-1 text-sm" value={p.monthlyBest} onChange={(e) => setPrice(i, 'monthlyBest', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} className="input w-24 py-1 text-sm" value={p.yearlyPrice} onChange={(e) => setPrice(i, 'yearlyPrice', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} className="input w-24 py-1 text-sm" value={p.yearlyBest} onChange={(e) => setPrice(i, 'yearlyBest', e.target.value)} /></td>
                    <td className="px-2 py-1"><button type="button" className="text-xs text-slate-400 hover:text-rose-600" onClick={() => removeCurrency(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'CAD', 'AED', 'SGD', 'JPY', 'ZAR'];

function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-slate-500">{label}</label>
      <input type="number" min={0} className="input py-1.5 text-sm" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}
