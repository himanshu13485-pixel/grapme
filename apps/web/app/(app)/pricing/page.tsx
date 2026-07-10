'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlans, Plan } from '@/lib/plans';
import { PageHeader, EmptyState } from '@/components/ui';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$', JPY: '¥', ZAR: 'R',
};
const money = (cur: string, n: number) => `${CURRENCY_SYMBOL[cur] ?? cur + ' '}${n.toLocaleString()}`;

export default function PricingPage() {
  const { plans, loading } = usePlans();
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [currency, setCurrency] = useState('');

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
      <PageHeader title="Pricing" subtitle="Choose the plan that fits — switch between monthly and yearly billing." />

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
      </div>

      {loading ? (
        <EmptyState message="Loading…" />
      ) : priced.length === 0 ? (
        <EmptyState message="No plans available." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {priced.map((p) => <PlanCard key={p.id} plan={p} period={period} currency={currency} />)}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, period, currency }: { plan: Plan; period: 'monthly' | 'yearly'; currency: string }) {
  const pr = (plan.pricing ?? []).find((x) => x.currency === currency);
  const price = pr ? (period === 'monthly' ? pr.monthlyPrice : pr.yearlyPrice) : 0;
  const best = pr ? (period === 'monthly' ? pr.monthlyBest : pr.yearlyBest) : 0;
  const showPrice = pr && (price > 0 || best > 0);
  const effective = best > 0 ? best : price;
  const emailOn = plan.emailEnabled !== false;
  const linkedInOn = plan.linkedInEnabled !== false;

  return (
    <div className="card flex flex-col overflow-hidden p-0">
      <div className="p-5" style={{ borderTop: `4px solid ${plan.color}` }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{plan.name}</h3>
          <div className="flex gap-1 text-xs">
            {emailOn && <span className="rounded-full bg-slate-100 px-2 py-0.5">📧</span>}
            {linkedInOn && <span className="rounded-full bg-slate-100 px-2 py-0.5">🔗</span>}
          </div>
        </div>
        <div className="mt-3">
          {showPrice ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">{money(currency, effective)}</span>
              <span className="text-sm text-slate-400">/{period === 'monthly' ? 'mo' : 'yr'}</span>
              {best > 0 && price > best && <span className="text-sm text-slate-400 line-through">{money(currency, price)}</span>}
            </div>
          ) : (
            <div className="text-sm font-medium text-slate-500">Contact us for pricing</div>
          )}
          {plan.validityDays ? <div className="mt-1 text-xs text-slate-400">Valid for {plan.validityDays} days</div> : null}
        </div>
      </div>

      <div className="flex-1 border-t border-slate-100 p-5 text-sm">
        {emailOn && (
          <div className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">📧 Email</div>
            <ul className="space-y-1 text-slate-600">
              <li>✓ {plan.emailCredits ?? 0} credits</li>
              <li>✓ {(plan.mailboxLimit ?? 0) > 0 ? plan.mailboxLimit : 'Unlimited'} mailboxes</li>
              <li>✓ {(plan.emailCampaignLimit ?? 0) > 0 ? plan.emailCampaignLimit : 'Unlimited'} campaigns</li>
            </ul>
          </div>
        )}
        {linkedInOn && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">🔗 LinkedIn</div>
            <ul className="space-y-1 text-slate-600">
              <li>✓ {plan.linkedInCredits ?? 0} credits</li>
              <li>✓ {plan.seatLimit ?? 0} seats</li>
              <li>✓ {(plan.linkedInCampaignLimit ?? 0) > 0 ? plan.linkedInCampaignLimit : 'Unlimited'} campaigns</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
