import type { Metadata } from 'next';
import {
  ShieldCheck,
  Users,
  Mail,
  FileText,
  Repeat,
  BarChart3,
  Lock,
  Bell,
  ShieldAlert,
} from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Approval workflows, multi-channel campaigns, deliverability protection, and full audit trails — the Grapme feature set.',
};

const GROUPS = [
  {
    icon: ShieldCheck,
    title: 'Approval & governance',
    items: [
      'Every campaign launch, schedule, follow-up sequence, contact import, and mailbox change enters a Pending → Approved/Rejected queue',
      'A super admin — or a sub-admin with the right permission — must approve before anything goes live',
      'Users build and draft freely; they cannot execute without an approved state',
      'One unified approval center listing every pending item across the tenant',
    ],
  },
  {
    icon: Users,
    title: 'Multi-tenant & roles',
    items: [
      'Row-level tenant isolation — a user only ever sees their own contacts, campaigns, mailboxes, and reports',
      'Super Admin, Sub-Admin, and User roles with a granular, toggleable permission system',
      'Sub-admins are scoped to only the users and campaigns explicitly assigned to them',
      'Credits/balance module so admins can grant, deduct, and price usage per client',
    ],
  },
  {
    icon: Mail,
    title: 'Mailboxes & multi-channel campaigns',
    items: [
      'Connect SMTP/POP/IMAP mailboxes with encrypted credentials (AES-256-GCM) and a live connection test before saving',
      'LinkedIn as a second outreach channel — client-owned accounts run connection and messaging sequences',
      'Multi-step follow-up sequences, conditional on open, reply, or no-reply',
    ],
  },
  {
    icon: FileText,
    title: 'Contacts & templates',
    items: [
      'Bulk import via CSV/Excel with duplicate detection and email validation (syntax + MX record)',
      'Contact lists, tags, and segments',
      'Drag-drop + HTML template builder with variable personalization ({{name}}, {{company}}, custom fields)',
      'Per-template spam-score / deliverability lint before it ever reaches a contact',
    ],
  },
  {
    icon: Repeat,
    title: 'Sending engine',
    items: [
      'Time-zone aware scheduling with configurable daily send caps',
      'Warm-up-friendly send speed with jitter between sends',
      'Automatic pause of follow-ups once a reply is detected (IMAP polling / threading)',
      'Bounce classification (hard/soft) with auto-suppression',
    ],
  },
  {
    icon: BarChart3,
    title: 'Analytics & reporting',
    items: [
      'Per-campaign performance: sent, delivered, opens, clicks, replies, bounces',
      'Global dashboard: active campaigns, scheduled sends, follow-ups, bounce rate, open/click rate',
      'Role-aware aggregates — a sub-admin sees their assigned scope, a user sees their own',
    ],
  },
  {
    icon: ShieldAlert,
    title: 'Deliverability & compliance',
    items: [
      'Live SPF / DKIM / DMARC DNS check with a deliverability score, run per sending domain',
      'Tenant-level suppression list, unsubscribe handling, and one-click unsubscribe footers',
      'GDPR data-portability export and right-to-erasure for any contact',
    ],
  },
  {
    icon: Lock,
    title: 'Security & audit',
    items: [
      'Argon2id password hashing; access + refresh JWT with rotation',
      'Mailbox credentials encrypted at rest, never returned in plaintext to the client',
      'Immutable, exportable activity log covering every action taken by every role',
    ],
  },
  {
    icon: Bell,
    title: 'Notifications',
    items: [
      'In-app notifications for approvals, replies, and campaign state changes',
      'Optional email and webhook notifications',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden py-20">
        <FloatingDecor variant="a" />
        <Container className="relative z-10 max-w-2xl text-center">
          <Reveal>
            <h1 className="mb-5 font-display text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[1] tracking-tightest">Everything an agency needs to run outreach <span className="text-brand-gradient">safely</span></h1>
            <p className="text-lg text-muted">
              One dashboard for mailboxes, campaigns, contacts, and reports — with an approval gate on anything that could
              damage a client&apos;s domain reputation.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="relative overflow-hidden pb-20">
        <FloatingDecor variant="c" />
        <Container className="relative z-10">
          <div className="grid gap-6 md:grid-cols-2">
            {GROUPS.map((group, i) => (
              <Reveal key={group.title} delay={(i % 2) * 90}>
                <TiltCard max={8} className="group h-full rounded-2xl border border-line bg-paper/85 p-7 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand transition-transform group-hover:scale-125 group-hover:-rotate-12">
                      <group.icon size={20} />
                    </span>
                    <h2 className="text-lg font-bold text-ink">{group.title}</h2>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-muted">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="relative overflow-hidden border-t border-line bg-mist/60 py-20">
        <FloatingDecor variant="b" />
        <Container className="relative z-10 max-w-3xl text-center">
          <Reveal>
            <h2 className="mb-3 text-2xl font-extrabold text-ink">See it on your own campaigns</h2>
            <p className="mb-8 text-muted">Book a walkthrough and we&apos;ll show the approval queue running live.</p>
            <LeadForm />
          </Reveal>
        </Container>
      </section>
    </>
  );
}
