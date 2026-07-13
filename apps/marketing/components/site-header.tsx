'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { Container } from './container';
import { LogoMark } from './logo';
import { NAV_LINKS, SITE } from '@/lib/site';

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
      <Container className="flex h-[70px] items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 font-grotesk text-[20px] font-bold tracking-tightest text-ink">
          <LogoMark size={30} />
          {SITE.name}
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative px-3 py-2 text-[14px] font-semibold text-muted transition hover:text-ink"
            >
              {link.label}
              <span className="absolute inset-x-3 -bottom-0.5 h-0.5 origin-left scale-x-0 rounded-full bg-brand transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={SITE.appUrl}
            className="text-[14px] font-bold text-muted transition hover:text-ink"
          >
            Log in
          </a>
          <Link
            href="/contact"
            className="btn-shine group inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white transition hover:bg-brand active:scale-[0.97]"
          >
            Book a demo
            <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink lg:hidden"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </Container>

      {open && (
        <div className="border-t border-line bg-paper lg:hidden">
          <Container className="flex flex-col gap-1 py-5">
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
            <a href={SITE.appUrl} className="px-3 py-2.5 text-base font-bold text-ink/80 hover:text-ink">
              Log in
            </a>
            <Link
              href="/contact"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white"
            >
              Book a demo <ArrowUpRight size={16} />
            </Link>
          </Container>
        </div>
      )}
    </header>
  );
}
