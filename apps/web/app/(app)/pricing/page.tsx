'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlans, Plan } from '@/lib/plans';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';
import { PaymentLogos } from '@/components/PaymentLogos';

interface Profile { id: string; name: string; plan?: string }

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$', JPY: '¥', ZAR: 'R',
};
const money = (cur: string, n: number) => `${CURRENCY_SYMBOL[cur] ?? cur + ' '}${n.toLocaleString()}`;

export default function PricingPage() {
  const { plans, loading } = usePlans();
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT';
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [currency, setCurrency] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [selecting, setSelecting] = useState('');

  useEffect(() => {
    if (!isClient) return;
    api.get<Profile[]>('/my/clients').then((rows) => {
      setProfiles(rows);
      if (rows[0]) setProfileId(rows[0].id);
    }).catch(() => {});
  }, [isClient]);

  async function selectPlan(plan: Plan) {
    if (!profileId) { alert('Pick a workspace first.'); return; }
    setSelecting(plan.id);
    try {
      const r = await api.post<{ mode: string; paymentLink?: string | null }>('/billing/plan-requests', {
        clientId: profileId, plan: plan.name, currency, period,
      });
      if (r.paymentLink) { window.location.href = r.paymentLink; return; }
      alert(r.mode === 'AUTO'
        ? 'Request created. Online payment isn’t available yet — your account team will confirm activation.'
        : 'Request submitted. Your account team will confirm the plan after payment.');
    } catch (e: any) {
      alert(e?.message ?? 'Could not submit the request.');
    } finally { setSelecting(''); }
  }

  // Currencies present across all plans' pricing.
  const currencies = useMemo(() => {
    const set = new Set<string>();
    plans.forEach((p) => (p.pricing ?? []).forEach((pr) => set.add(pr.currency)));
    return [...set];
  }, [plans]);

  useEffect(() => {
    if (currencies.length && !currencies.includes(currency)) setCurrency(currencies[0]);
  }, [currencies, currency]);

  const priced = [...plans].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div>
      <PageHeader title="Pricing" subtitle="Choose the plan that fits — switch between monthly and yearly billing. All prices are exclusive of taxes." />

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {(['monthly', 'yearly'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPeriod(m)}
              className={`rounded-lg px-5 py-2 text-sm font-medium capitalize transition ${period === m ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {m}{m === 'yearly' && <span className="ml-1 text-[10px] opacity-80">save more</span>}
            </button>
          ))}
        </div>
        {currencies.length > 0 && (
          <select className="input w-28" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {isClient && profiles.length > 1 && (
          <select className="input w-56" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <EmptyState message="Loading…" />
      ) : priced.length === 0 ? (
        <EmptyState message="No plans available." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {priced.map((p) => {
            const current = isClient && profiles.find((x) => x.id === profileId)?.plan === p.name;
            return (
              <PlanCard
                key={p.id}
                plan={p}
                period={period}
                currency={currency}
                onSelect={isClient ? () => selectPlan(p) : undefined}
                selecting={selecting === p.id}
                current={!!current}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, period, currency, onSelect, selecting, current }: { plan: Plan; period: 'monthly' | 'yearly'; currency: string; onSelect?: () => void; selecting?: boolean; current?: boolean }) {
  const pr = (plan.pricing ?? []).find((x) => x.currency === currency);
  const price = pr ? (period === 'monthly' ? pr.monthlyPrice : pr.yearlyPrice) : 0;
  const best = pr ? (period === 'monthly' ? pr.monthlyBest : pr.yearlyBest) : 0;
  const showPrice = pr && (price > 0 || best > 0);
  const effective = best > 0 ? best : price;
  const emailOn = plan.emailEnabled !== false;
  const linkedInOn = plan.linkedInEnabled !== false;
  // Entitlements can differ by period: yearly overrides fall back to the base (monthly) value.
  const ye = plan.yearlyEntitlements ?? {};
  const ent = (key: keyof typeof ye, base?: number | null) =>
    period === 'yearly' && typeof ye[key] === 'number' ? (ye[key] as number) : (base ?? 0);
  const emailCredits = ent('emailCredits', plan.emailCredits);
  const mailboxLimit = ent('mailboxLimit', plan.mailboxLimit);
  const emailCampaignLimit = ent('emailCampaignLimit', plan.emailCampaignLimit);
  const linkedInCredits = ent('linkedInCredits', plan.linkedInCredits);
  const seatLimit = ent('seatLimit', plan.seatLimit);
  const linkedInCampaignLimit = ent('linkedInCampaignLimit', plan.linkedInCampaignLimit);
  // Monthly billing = a 30-day window; yearly uses the plan's (period) validity.
  const validDays = period === 'monthly' ? 30 : ent('validityDays', plan.validityDays);

  return (
    <div className={`card relative flex flex-col overflow-hidden p-0 ${plan.popular ? 'ring-2 ring-brand-500' : ''}`}>
      {plan.popular && (
        <div className="absolute right-3 top-3 rounded-full bg-brand-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
          ★ Most popular
        </div>
      )}
      <div className="p-5" style={{ borderTop: `4px solid ${plan.color}` }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{plan.name}</h3>
          <div className={`flex gap-1 text-xs ${plan.popular ? 'mr-24' : ''}`}>
            {emailOn && <span className="rounded-full bg-slate-100 px-2 py-0.5">📧</span>}
            {linkedInOn && <span className="rounded-full bg-slate-100 px-2 py-0.5">🔗</span>}
          </div>
        </div>
        <div className="mt-3">
          {showPrice ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-slate-900">{money(currency, effective)}</span>
                <span className="text-sm text-slate-400">/{period === 'monthly' ? 'mo' : 'yr'}</span>
                {best > 0 && price > best && <span className="text-sm text-slate-400 line-through">{money(currency, price)}</span>}
              </div>
              <div className="text-[11px] text-slate-400">+ Taxes extra</div>
            </>
          ) : (
            <div className="text-sm font-medium text-slate-500">Contact us for pricing</div>
          )}
          {validDays ? <div className="mt-1 text-xs text-slate-400">Valid for {validDays} days</div> : null}
        </div>
      </div>

      <div className="flex-1 border-t border-slate-100 p-5 text-sm">
        {plan.cardStyle === 'features' ? (
          <>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What&apos;s included</div>
            <ul className="space-y-1.5 text-slate-600">
              {(plan.features ?? []).map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-500">✓</span> {f}
                </li>
              ))}
              {(plan.features ?? []).length === 0 && <li className="text-slate-400">Features coming soon.</li>}
            </ul>
            <PaymentLogos className="mt-4" />
          </>
        ) : (
          <>
            {emailOn && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">📧 Email</div>
                <ul className="space-y-1 text-slate-600">
                  <li>✓ {emailCredits} credits</li>
                  <li>✓ {mailboxLimit > 0 ? mailboxLimit : 'Unlimited'} mailboxes</li>
                  <li>✓ {emailCampaignLimit > 0 ? emailCampaignLimit : 'Unlimited'} campaigns</li>
                </ul>
              </div>
            )}
            {linkedInOn && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">🔗 LinkedIn</div>
                <ul className="space-y-1 text-slate-600">
                  <li>✓ {linkedInCredits} credits</li>
                  <li>✓ {seatLimit} seats</li>
                  <li>✓ {linkedInCampaignLimit > 0 ? linkedInCampaignLimit : 'Unlimited'} campaigns</li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {onSelect && (
        <div className="border-t border-slate-100 p-4">
          {current ? (
            <div className="rounded-lg bg-emerald-50 py-2 text-center text-sm font-medium text-emerald-700">✓ Current plan</div>
          ) : (
            <button className="btn-primary w-full" disabled={selecting} onClick={onSelect}>
              {selecting ? 'Submitting…' : 'Select / Upgrade'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
