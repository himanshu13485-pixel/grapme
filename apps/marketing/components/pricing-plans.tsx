'use client';

import { useMemo, useState } from 'react';
import { Check, ArrowUpRight, Mail, Linkedin } from 'lucide-react';
import { Reveal } from './reveal';
import { TiltCard } from './tilt-card';
import { PaymentLogos } from './payment-logos';
import { SITE } from '@/lib/site';
import type { PublicPlan, YearlyEntitlements } from '@/lib/plans';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$', JPY: '¥', ZAR: 'R',
};
const money = (cur: string, n: number) => `${CURRENCY_SYMBOL[cur] ?? cur + ' '}${n.toLocaleString('en-US')}`;

/** Interactive live-plan pricing table for the marketing site — mirrors the
 *  in-app Membership page: monthly/yearly, currency, base-vs-best price,
 *  dynamic validity, taxes, and channel-grouped entitlements. */
export function PricingPlans({ plans }: { plans: PublicPlan[] }) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');

  const currencies = useMemo(() => {
    const set = new Set<string>();
    plans.forEach((p) => p.pricing.forEach((pr) => set.add(pr.currency)));
    return [...set];
  }, [plans]);
  const [currency, setCurrency] = useState(currencies[0] ?? '');
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] ?? '';

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-center gap-4">
        <div className="inline-flex rounded-2xl border border-line bg-paper/80 p-1 shadow-soft backdrop-blur">
          {(['monthly', 'yearly'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPeriod(m)}
              className={`rounded-xl px-6 py-2.5 text-sm font-bold capitalize transition ${period === m ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {m}
              {m === 'yearly' && <span className="ml-1.5 text-[10px] font-semibold opacity-80">save more</span>}
            </button>
          ))}
        </div>
        {currencies.length > 1 && (
          <select
            className="rounded-xl border border-line bg-paper/80 px-4 py-2.5 text-sm font-bold text-ink shadow-soft backdrop-blur outline-none"
            value={activeCurrency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      <div
        className={`grid gap-6 ${
          plans.length === 1
            ? 'mx-auto max-w-md' // a lone plan sits centered, not stretched
            : plans.length === 2
              ? 'md:mx-auto md:max-w-3xl md:grid-cols-2'
              : 'md:grid-cols-3'
        }`}
      >
        {plans.map((plan, i) => (
          <Reveal key={plan.id} delay={i * 90}>
            <PlanCard plan={plan} period={period} currency={activeCurrency} />
          </Reveal>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        Prices are exclusive of taxes and can be tailored to your team.{' '}
        <a href={`${SITE.appUrl}/client?mode=register`} className="font-semibold text-brand hover:underline">Create your account</a>{' '}
        or request a custom quote below.
      </p>
    </>
  );
}

function PlanCard({ plan, period, currency }: { plan: PublicPlan; period: 'monthly' | 'yearly'; currency: string }) {
  const pr = plan.pricing.find((x) => x.currency === currency);
  const price = pr ? (period === 'monthly' ? pr.monthlyPrice : pr.yearlyPrice) : 0;
  const best = pr ? (period === 'monthly' ? pr.monthlyBest : pr.yearlyBest) : 0;
  const showPrice = !!pr && (price > 0 || best > 0);
  const effective = best > 0 ? best : price;

  const featuresMode = plan.cardStyle === 'features';
  const emailOn = plan.emailEnabled !== false;
  const linkedInOn = plan.linkedInEnabled !== false;

  // Entitlements can differ by period: yearly overrides fall back to the monthly value.
  const ye: YearlyEntitlements = plan.yearlyEntitlements ?? {};
  const ent = (key: keyof YearlyEntitlements, base?: number | null) =>
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
    <TiltCard
      max={7}
      className={`relative flex h-full flex-col overflow-hidden rounded-2xl border backdrop-blur-sm transition ${
        plan.popular
          ? 'border-brand/60 bg-brand-50/40 shadow-card md:-translate-y-3'
          : 'border-line bg-paper/85 shadow-soft hover:border-brand/40 hover:shadow-card'
      }`}
    >
      <div className="p-6" style={{ borderTop: `4px solid ${plan.color}` }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-extrabold text-ink">{plan.name}</h3>
            {plan.popular && (
              <span className="rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                ★ Most popular
              </span>
            )}
          </div>
          {!featuresMode && (
            <div className="flex gap-1.5 text-muted">
              {emailOn && <span className="grid h-7 w-7 place-items-center rounded-full bg-mist"><Mail size={14} /></span>}
              {linkedInOn && <span className="grid h-7 w-7 place-items-center rounded-full bg-mist"><Linkedin size={14} /></span>}
            </div>
          )}
        </div>

        <div className="mt-4">
          {showPrice ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-ink">{money(currency, effective)}</span>
                <span className="text-sm text-muted">/{period === 'monthly' ? 'mo' : 'yr'}</span>
                {best > 0 && price > best && (
                  <span className="text-sm text-muted line-through">{money(currency, price)}</span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">+ Taxes extra</div>
            </>
          ) : (
            <div className="text-lg font-bold text-ink">Custom pricing</div>
          )}
          {validDays ? <div className="mt-1 text-xs text-muted">Valid for {validDays} days</div> : null}
        </div>
      </div>

      <div className="flex-1 border-t border-line p-6 text-sm">
        {featuresMode ? (
          <>
            <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-muted">What&apos;s included</div>
            <ul className="flex flex-col gap-2 text-ink/90">
              {plan.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-brand" /> {f}
                </li>
              ))}
            </ul>
            <PaymentLogos className="mt-5" />
          </>
        ) : (
          <>
            {emailOn && (
              <div className="mb-4">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                  <Mail size={13} /> Email
                </div>
                <ul className="flex flex-col gap-1.5 text-ink/90">
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {emailCredits.toLocaleString('en-US')} credits</li>
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {mailboxLimit > 0 ? mailboxLimit : 'Unlimited'} mailboxes</li>
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {emailCampaignLimit > 0 ? emailCampaignLimit : 'Unlimited'} campaigns</li>
                </ul>
              </div>
            )}
            {linkedInOn && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                  <Linkedin size={13} /> LinkedIn
                </div>
                <ul className="flex flex-col gap-1.5 text-ink/90">
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {linkedInCredits.toLocaleString('en-US')} credits</li>
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {seatLimit > 0 ? seatLimit : 'Unlimited'} seats</li>
                  <li className="flex items-center gap-2"><Check size={15} className="shrink-0 text-brand" /> {linkedInCampaignLimit > 0 ? linkedInCampaignLimit : 'Unlimited'} campaigns</li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-5">
        <a
          href={`${SITE.appUrl}/client?mode=register`}
          className="group inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white transition hover:bg-brand active:scale-[0.97]"
        >
          Get started
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </TiltCard>
  );
}
