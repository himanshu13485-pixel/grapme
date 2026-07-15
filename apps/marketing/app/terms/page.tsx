import type { Metadata } from 'next';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { FloatingDecor } from '@/components/floating-decor';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `Terms governing use of ${SITE.name}'s website and services.`,
};

export default function TermsPage() {
  return (
    <section className="relative overflow-hidden py-20">
      <FloatingDecor variant="d" />
      <Container className="relative z-10 max-w-3xl">
        <Reveal>
          <h1 className="mb-3 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-bold tracking-tightest text-ink">Terms of Service</h1>
          <p className="mb-10 text-sm text-muted">Last updated: {new Date().getFullYear()}</p>
        </Reveal>

        <Reveal delay={120} className="prose-blog">
          <h2>Using this site</h2>
          <p>
            This website describes {SITE.name}&apos;s outreach automation platform and lets you request a demo or
            contact our team. By submitting a form on this site, you confirm the details you provide are accurate and
            that you agree to be contacted about our services.
          </p>

          <h2>Service delivery</h2>
          <p>
            Specific plan entitlements (validity, credits, seats, campaign limits) and pricing for any account are
            agreed separately with our team — the examples on our <a href="/pricing">Pricing page</a> are illustrative,
            not a binding quote.
          </p>

          <h2>Your responsibility for sender compliance</h2>
          <p>
            GrapMe provides deliverability checks, sending controls, and optional approval workflows; you remain responsible
            for ensuring your outreach — including LinkedIn account use — complies with applicable law and the terms of
            any third-party platform you connect.
          </p>

          <h2>Changes to these terms</h2>
          <p>We may update these terms from time to time; the version on this page is the one currently in effect.</p>

          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to us via the channels on our <a href="/contact">Contact page</a>.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
