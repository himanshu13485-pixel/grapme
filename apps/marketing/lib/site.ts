export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.grapme.com';

export const SITE = {
  name: 'GrapMe',
  tagline: 'LinkedIn & Email Automation You Run Yourself',
  description:
    'GrapMe is the LinkedIn & cold-email automation platform built for businesses to run their own outreach — no agency needed. Connect your mailboxes, build campaigns, and send safely with deliverability protection built in.',
  phone: '+91-9891797878',
  phoneHref: 'tel:+919891797878',
  whatsappHref: 'https://wa.me/919891797878',
  // Client-side link target — NEXT_PUBLIC_* so it's available in the browser.
  // Set NEXT_PUBLIC_APP_URL=http://localhost:3000 in .env.local for local dev.
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.grapme.com',
  twitter: '@grapme',
} as const;

export const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/contact', label: 'Contact' },
] as const;
