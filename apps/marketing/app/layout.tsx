import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SiteBackground } from '@/components/site-background';
import { ScrollProgress } from '@/components/scroll-progress';
import { SITE, SITE_URL } from '@/lib/site';

// Self-hosted rather than next/font/google: that fetches from fonts.gstatic.com
// at BUILD time, so a server that cannot reach Google cannot build the site at
// all. These are the same Google variable fonts, latin subset, committed under
// ./fonts — the build now needs no network.
const manrope = localFont({
  src: [{ path: './fonts/manrope-latin.woff2', weight: '200 800', style: 'normal' }],
  variable: '--font-manrope',
  display: 'swap',
});

// Editorial display serif for large headlines (with italic for accents)
const display = localFont({
  src: [
    { path: './fonts/fraunces-latin.woff2', weight: '400 700', style: 'normal' },
    { path: './fonts/fraunces-latin-italic.woff2', weight: '400 700', style: 'italic' },
  ],
  variable: '--font-display',
  display: 'swap',
});

// Geometric grotesk for eyebrow labels and numerals
const grotesk = localFont({
  src: [{ path: './fonts/space-grotesk-latin.woff2', weight: '300 700', style: 'normal' }],
  variable: '--font-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  icons: {
    icon: 'https://www.grapme.com/images/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${display.variable} ${grotesk.variable}`}>
      <head>
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important;}`}</style>
        </noscript>
      </head>
      <body className="relative min-h-screen font-sans text-ink antialiased">
        <SiteBackground />
        <ScrollProgress />
        <div className="relative z-10">
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
