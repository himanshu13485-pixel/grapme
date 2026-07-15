import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';
import { PricingPlans } from '@/components/pricing-plans';
import { fetchPublicPlans } from '@/lib/plans';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'GrapMe plans are configured around mailbox seats, send credits, and campaign limits per channel — request a quote for your team.',
};

const DIMENSIONS = [
  'Validity period — how long the plan runs before renewal',
  'Credit balance — allocated per user and drawn down per send',
  'Mailbox / seat count — how many connected mailboxes or LinkedIn accounts',
  'Campaign limits — per channel, for Email and LinkedIn separately',
];

const EXAMPLES = [
  {
    name: 'Starter',
    body: 'A handful of connected mailboxes, one or two active campaigns at a time.',
    features: ['Small mailbox/seat count', 'Email + LinkedIn channels', 'Deliverability checks included'],
  },
  {
    name: 'Growth',
    body: 'Multiple team members running concurrent campaigns across channels, with role-based access.',
    features: ['Higher mailbox/seat count', 'Sub-admin roles with scoped permissions', 'Priority support'],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    body: 'High send volume, dedicated oversight, and custom entitlement limits.',
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
              Choose the plan that fits — switch between monthly and yearly billing, in your currency.
              All prices are exclusive of taxes and can be tailored to your team.
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
            <PricingPlans plans={plans} />
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
                campaign limits are configured to match your team.
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
            <p className="mb-8 text-muted">Tell us your team size and channels, and we&apos;ll size a plan.</p>
            <LeadForm />
          </Reveal>
        </Container>
      </section>
    </>
  );
}
