import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Container } from './container';
import { LogoMark } from './logo';
import { NAV_LINKS, SITE } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-ink text-white">
      <div className="bg-glow-brand animate-drift-slow pointer-events-none absolute -bottom-32 right-10 h-[38vw] w-[38vw] rounded-full blur-[130px]" />

      {/* CTA band */}
      <div className="relative z-10 border-b border-lineDark py-12">
        <Container>
          <Link href="/contact" className="group flex flex-wrap items-center justify-between gap-6">
            <h2 className="font-display text-[clamp(2rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-tightest">
              Let&apos;s <span className="text-brand-400">talk.</span>
            </h2>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-4 text-base font-bold text-ink transition group-hover:bg-brand group-hover:text-white">
              Book a demo
              <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
            </span>
          </Link>
        </Container>
      </div>

      <Container className="relative z-10 py-14">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-[320px]">
            <Link href="/" className="mb-4 flex items-center gap-2.5 font-grotesk text-xl font-bold">
              <LogoMark size={28} />
              {SITE.name}
            </Link>
            <p className="text-sm text-white/55">{SITE.description}</p>
            <address className="mt-5 text-sm not-italic leading-relaxed text-white/50">
              <span className="font-semibold text-white/70">GrapOut Strategic Partners Private Limited</span><br />
              Unit No. 121, F.F., Tower-B, Vatika Mindscapes,<br />
              Sector 27D, Faridabad, Haryana, 121003, India.
            </address>
          </div>

          <div className="flex flex-col gap-2.5 text-sm">
            <span className="mb-1 font-bold uppercase tracking-wide text-white/40">Product</span>
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-white/70 hover:text-white">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-2.5 text-sm">
            <span className="mb-1 font-bold uppercase tracking-wide text-white/40">Legal</span>
            <Link href="/privacy" className="text-white/70 hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-white/70 hover:text-white">
              Terms of Service
            </Link>
          </div>

          <div className="flex flex-col gap-2.5 text-sm">
            <span className="mb-1 font-bold uppercase tracking-wide text-white/40">Reach us</span>
            <a href={SITE.whatsappHref} target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white">
              WhatsApp
            </a>
            <a href={SITE.phoneHref} className="text-white/70 hover:text-white">
              {SITE.phone}
            </a>
          </div>
        </div>

        <div className="mt-12 border-t border-lineDark pt-6 text-sm text-white/40">
          &copy; {new Date().getFullYear()} {SITE.name}. All rights reserved.
        </div>
      </Container>
    </footer>
  );
}
