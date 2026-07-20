'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { LogoMark } from './logo';
import { NAV_LINKS, SITE } from '@/lib/site';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    // transparent & full-width at the top → frosted rounded card that shrinks on scroll (WDC-style)
    <header className="pointer-events-none sticky top-0 z-50 px-3 pt-4 sm:px-4">
      <div
        className={`pointer-events-auto mx-auto flex items-center justify-between gap-5 rounded-3xl border px-5 transition-[max-width,background-color,border-color,box-shadow] duration-300 ease-out sm:px-7 ${
          scrolled
            ? 'h-[72px] max-w-5xl border-line bg-paper/85 shadow-card backdrop-blur-xl'
            : 'h-[80px] max-w-7xl border-transparent bg-transparent'
        }`}
      >
        <Link href="/" className="flex items-center gap-3 font-grotesk text-[23px] font-bold tracking-tightest text-ink">
          <LogoMark size={38} />
          {SITE.name}
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative px-4 py-2.5 text-[16px] font-semibold text-muted transition hover:text-ink"
            >
              {link.label}
              <span className="absolute inset-x-4 -bottom-0.5 h-0.5 origin-left scale-x-0 rounded-full bg-brand transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a href={`${SITE.appUrl}/client`} className="px-2.5 text-[16px] font-bold text-muted transition hover:text-ink">
            Log in
          </a>
          <a href={`${SITE.appUrl}/client?mode=register`} className="px-2.5 text-[16px] font-bold text-ink transition hover:text-brand">
            Sign up
          </a>
          <Link
            href="/contact"
            className="btn-shine group inline-flex items-center gap-1.5 rounded-full bg-ink px-6 py-3 text-[16px] font-bold text-white transition hover:bg-brand active:scale-[0.97]"
          >
            Book a demo
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="grid h-12 w-12 place-items-center rounded-full border border-line bg-paper/70 text-ink backdrop-blur lg:hidden"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div className="pointer-events-auto lg:hidden">
          <div className="mx-auto mt-2 flex max-w-4xl flex-col gap-1 rounded-2xl border border-line bg-paper p-4 shadow-card">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-semibold text-ink/80 hover:bg-mist hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
            <a href={`${SITE.appUrl}/client`} className="px-3 py-2.5 text-base font-bold text-ink/80 hover:text-ink">
              Log in
            </a>
            <a href={`${SITE.appUrl}/client?mode=register`} className="px-3 py-2.5 text-base font-bold text-ink/80 hover:text-ink">
              Sign up
            </a>
            <Link
              href="/contact"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white"
            >
              Book a demo <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
