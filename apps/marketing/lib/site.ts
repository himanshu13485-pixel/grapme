export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.grapme.com';

export const SITE = {
  name: 'Grapme',
  tagline: 'Approval-Gated LinkedIn & Email Automation for Agencies',
  description:
    'Grapme is the approval-gated LinkedIn & cold-email automation platform for agencies and managed-service providers — run outreach across every client mailbox, with nothing going out until an admin approves it.',
  phone: '+91-9891797878',
  phoneHref: 'tel:+919891797878',
  whatsappHref: 'https://wa.me/919891797878',
  appUrl: 'https://app.grapme.com',
  twitter: '@grapme',
} as const;

export const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/contact', label: 'Contact' },
] as const;
