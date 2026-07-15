import type { Metadata } from 'next';
import { FilePlus, Send, CheckSquare, CalendarClock, PlayCircle, LineChart } from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'The campaign lifecycle behind GrapMe — connect, build, launch, schedule, run, and report.',
};

const STAGES = [
  {
    icon: FilePlus,
    title: '1. Connect',
    body: 'Connect an SMTP/IMAP mailbox or a LinkedIn account, with a live connection test — no developer needed.',
  },
  {
    icon: Send,
    title: '2. Build',
    body: 'Build a campaign against a connected mailbox: contact list, template, schedule, and any follow-up steps. It saves as a draft — nothing is committed yet.',
  },
  {
    icon: CheckSquare,
    title: '3. Launch it yourself',
    body: 'Review your draft and launch it whenever you’re ready. No approval chain, no waiting on anyone else — unless your team chooses to turn one on for itself.',
  },
  {
    icon: CalendarClock,
    title: '4. Schedule',
    body: 'Campaigns run with time-zone awareness, a daily send cap, and a warm-up-friendly send speed with jitter between sends.',
  },
  {
    icon: PlayCircle,
    title: '5. Run',
    body: 'The dispatcher fans out sends per eligible, non-suppressed contact. Follow-up steps pause automatically the moment a reply is detected.',
  },
  {
    icon: LineChart,
    title: '6. Report',
    body: 'Sent, delivered, opens, clicks, replies, and bounces roll up per campaign and into your dashboard, live.',
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="relative overflow-hidden py-20">
        <FloatingDecor variant="a" />
        <Container className="relative z-10 max-w-3xl text-center">
          <Reveal>
            <h1 className="mb-5 font-display text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[1] tracking-tightest">The lifecycle behind <span className="text-brand-gradient">every</span> campaign</h1>
            <p className="text-lg text-muted">
              Connect your accounts, build your campaign, and launch it yourself — with safety checks built in at
              every step.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="relative overflow-hidden pb-20">
        <FloatingDecor variant="c" />
        <Container className="relative z-10 max-w-3xl">
          <div className="flex flex-col gap-6">
            {STAGES.map((stage, i) => (
              <Reveal key={stage.title} delay={i * 70}>
                <TiltCard max={6} className="group flex gap-5 rounded-2xl border border-line bg-paper/85 p-6 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand transition-transform group-hover:scale-125 group-hover:-rotate-12">
                    <stage.icon size={20} />
                  </span>
                  <div>
                    <h2 className="mb-1.5 text-lg font-bold text-ink">{stage.title}</h2>
                    <p className="text-sm text-muted">{stage.body}</p>
                  </div>
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
            <h2 className="mb-3 text-2xl font-extrabold text-ink">Walk through it on your own account</h2>
            <p className="mb-8 text-muted">We&apos;ll set up a demo tenant and show the full lifecycle end to end.</p>
            <LeadForm />
          </Reveal>
        </Container>
      </section>
    </>
  );
}
