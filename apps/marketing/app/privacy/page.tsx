import type { Metadata } from 'next';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { FloatingDecor } from '@/components/floating-decor';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE.name} collects, uses, and protects your information.`,
};

export default function PrivacyPage() {
  return (
    <section className="relative overflow-hidden py-20">
      <FloatingDecor variant="d" />
      <Container className="relative z-10 max-w-3xl">
        <Reveal>
          <h1 className="mb-3 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-bold tracking-tightest text-ink">Privacy Policy</h1>
          <p className="mb-10 text-sm text-muted">Last updated: {new Date().getFullYear()}</p>
        </Reveal>

        <Reveal delay={120} className="prose-blog">
          <h2>What we collect on this site</h2>
          <p>
            When you submit a form on this website, we collect the information you provide directly — typically your
            name, phone number, and work email — so our team can respond to your enquiry or set up a demo.
          </p>

          <h2>How we use it</h2>
          <p>
            We use the information you submit to contact you about GrapMe, respond to your enquiry, and, where you have
            agreed to it, follow up about relevant plans. We do not sell your personal information to third parties.
          </p>

          <h2>Data inside the GrapMe platform</h2>
          <p>
            Contacts and mailbox credentials that customers upload into the GrapMe application itself (as opposed to
            this marketing site) are stored with tenant-level isolation and encrypted at rest, and are handled under the
            terms of your service agreement rather than this website policy.
          </p>

          <h2>Your choices</h2>
          <p>
            You can ask us to update or delete the information we hold about you at any time by contacting us through the
            channels on our <a href="/contact">Contact page</a>.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about this policy can be sent to us via WhatsApp or phone, listed on our{' '}
            <a href="/contact">Contact page</a>.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
