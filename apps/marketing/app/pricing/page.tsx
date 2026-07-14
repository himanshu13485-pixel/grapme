import type { Metadata } from 'next';
import { Check, ArrowUpRight } from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';
import { SITE } from '@/lib/site';
import { fetchPublicPlans, preferredPricing, formatMoney, planFeatures } from '@/lib/plans';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Grapme plans are configured around mailbox seats, send credits, and campaign limits per channel — request a quote for your agency.',
};

const DIMENSIONS = [
  'Validity period — how long the plan runs before renewal',
  'Credit balance — allocated per client and drawn down per send',
  'Mailbox / seat count — how many connected mailboxes or LinkedIn accounts',
  'Campaign limits — per channel, for Email and LinkedIn separately',
];

const EXAMPLES = [
  {
    name: 'Solo agency',
    body: 'A handful of client mailboxes, one or two active campaigns at a time.',
    features: ['Small mailbox/seat count', 'Email + LinkedIn channels', 'Standard approval workflow'],
  },
  {
    name: 'Growing agency',
    body: 'Multiple clients running concurrent campaigns across channels, with delegated approvals.',
    features: ['Higher mailbox/seat count', 'Sub-admin delegation with scoped permissions', 'Priority support'],
    highlighted: true,
  },
  {
    name: 'Enterprise agency',
    body: 'High client volume, dedicated oversight, and custom entitlement limits.',
    features: ['Custom seat and credit allocation', 'Dedicated account contact', 'Custom onboarding'],
  },
];

export default async function PricingPage() {
  const plans = await fetchPublicPlans();
  return (
    <>
      <section className="relative overflow-hidden py-20">
        <FloatingDecor variant="a" />
        <Container className="relative z-10 max-w-2xl text-center">
          <Reveal>
            <h1 className="mb-5 font-display text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[1] tracking-tightest">Plans built around how you <span className="text-brand-gradient">actually</span> run outreach</h1>
            <p className="text-lg text-muted">
              There&apos;s no fixed public price list — every plan is configured around the same four entitlement
              dimensions, sized to your agency.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="pb-16">
        <Container className="max-w-3xl">
          <Reveal>
            <div className="rounded-2xl border border-line bg-paper/85 p-8 shadow-soft backdrop-blur-sm">
              <h2 className="mb-5 text-lg font-bold text-ink">What every plan is built from</h2>
              <ul className="flex flex-col gap-3">
                {DIMENSIONS.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-sm text-ink/90">
                    <Check size={16} className="mt-0.5 shrink-0 text-brand" /> {d}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="relative overflow-hidden pb-20">
        <FloatingDecor variant="c" />
        <Container className="relative z-10">
          {plans ? (
            <>
              <div className={`grid gap-6 ${plans.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 md:mx-auto md:max-w-3xl'}`}>
                {plans.map((plan, i) => {
                  const price = preferredPricing(plan);
                  const highlighted = i === 1 && plans.length >= 3;
                  return (
                    <Reveal key={plan.id} delay={i * 90}>
                      <TiltCard
                        max={9}
                        className={`flex h-full flex-col rounded-2xl border p-8 ${highlighted ? 'border-brand/50 bg-brand-50/50 shadow-card md:-translate-y-3' : 'border-line bg-paper/85 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card'}`}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: plan.color }} />
                          <h2 className="text-xl font-extrabold text-ink">{plan.name}</h2>
                        </div>
                        <div className="mb-6">
                          {price && price.monthlyPrice > 0 ? (
                            <>
                              <span className="text-3xl font-extrabold text-ink">{formatMoney(price.monthlyPrice, price.currency)}</span>
                              <span className="text-sm text-muted"> / month</span>
                            </>
                          ) : (
                            <span className="text-lg font-bold text-ink">Custom pricing</span>
                          )}
                        </div>
                        <ul className="mb-6 flex flex-1 flex-col gap-3">
                          {planFeatures(plan).map((f) => (
                            <li key={f} className="flex items-start gap-2 text-sm text-ink/90">
                              <Check size={16} className="mt-0.5 shrink-0 text-brand" /> {f}
                            </li>
                          ))}
                        </ul>
                        <a
                          href={`${SITE.appUrl}/client`}
                          className={`group inline-flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-bold transition active:scale-[0.97] ${highlighted ? 'bg-brand text-white hover:bg-ink' : 'bg-ink text-white hover:bg-brand'}`}
                        >
                          Get started
                          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </a>
                      </TiltCard>
                    </Reveal>
                  );
                })}
              </div>
              <p className="mt-8 text-center text-sm text-muted">
                Prices are monthly starting points — every plan&apos;s validity, credits, seats, and campaign limits can
                be tailored to your agency. <a href={`${SITE.appUrl}/client`} className="font-semibold text-brand hover:underline">Create your account</a> or request a custom quote below.
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-6 md:grid-cols-3">
                {EXAMPLES.map((plan, i) => (
                  <Reveal key={plan.name} delay={i * 90}>
                    <TiltCard
                      max={9}
                      className={`h-full rounded-2xl border p-8 ${plan.highlighted ? 'border-brand/50 bg-brand-50/50 shadow-card md:-translate-y-3' : 'border-line bg-paper/85 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card'}`}
                    >
                      <h2 className="mb-2 text-xl font-extrabold text-ink">{plan.name}</h2>
                      <p className="mb-6 text-sm text-muted">{plan.body}</p>
                      <ul className="flex flex-col gap-3">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-start gap-2 text-sm text-ink/90">
                            <Check size={16} className="mt-0.5 shrink-0 text-brand" /> {f}
                          </li>
                        ))}
                      </ul>
                    </TiltCard>
                  </Reveal>
                ))}
              </div>
              <p className="mt-8 text-center text-sm text-muted">
                These are illustrative starting points, not fixed tiers — every plan&apos;s validity, credits, seats, and
                campaign limits are configured to match your agency.
              </p>
            </>
          )}
        </Container>
      </section>

      <section className="relative overflow-hidden border-t border-line bg-mist/60 py-20">
        <FloatingDecor variant="b" />
        <Container className="relative z-10 max-w-3xl text-center">
          <Reveal>
            <h2 className="mb-3 text-2xl font-extrabold text-ink">Request a plan and quote</h2>
            <p className="mb-8 text-muted">Tell us your client count and channels, and we&apos;ll size a plan.</p>
            <LeadForm />
          </Reveal>
        </Container>
      </section>
    </>
  );
}
