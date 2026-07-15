import type { Metadata } from 'next';
import { MessageCircle, Phone } from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { Reveal } from '@/components/reveal';
import { FloatingDecor } from '@/components/floating-decor';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with GrapMe — call, WhatsApp, or leave your details and we’ll be in touch.',
};

export default function ContactPage() {
  return (
    <section className="relative overflow-hidden py-20">
      <FloatingDecor variant="a" />
      <Container className="relative z-10 max-w-3xl">
        <Reveal className="mb-12 text-center">
          <h1 className="mb-5 font-display text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[1] tracking-tightest">Let&apos;s <span className="text-brand-gradient">talk.</span></h1>
          <p className="text-lg text-muted">
            Reach us directly, or leave your details below and our team will follow up.
          </p>
        </Reveal>

        <Reveal delay={100} className="mb-10 flex flex-wrap justify-center gap-4">
          <a
            href={SITE.phoneHref}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-6 py-3 font-bold text-ink transition hover:-translate-y-0.5 hover:border-brand/40 hover:text-brand"
          >
            <Phone size={18} /> {SITE.phone}
          </a>
          <a
            href={SITE.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-6 py-3 font-bold text-ink transition hover:-translate-y-0.5 hover:border-brand/40 hover:text-brand"
          >
            <MessageCircle size={18} /> WhatsApp
          </a>
        </Reveal>

        <Reveal delay={180}>
          <LeadForm />
        </Reveal>
      </Container>
    </section>
  );
}
