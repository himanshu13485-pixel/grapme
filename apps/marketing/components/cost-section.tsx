import { ShieldAlert, ScrollText, Scale } from 'lucide-react';
import { Container } from './container';
import { Reveal } from './reveal';
import { FloatingDecor } from './floating-decor';

const COSTS = [
  {
    icon: ShieldAlert,
    stat: 'Weeks',
    title: 'of warm-up, gone overnight',
    body: 'One careless campaign flags a client’s sending domain. Inbox placement tanks for every future send — and rebuilding reputation takes weeks you don’t have.',
  },
  {
    icon: Scale,
    stat: 'Yours',
    title: 'the compliance liability',
    body: 'A missed unsubscribe or a bought list becomes the agency’s problem, not the intern’s. CAN-SPAM and GDPR penalties land on you.',
  },
  {
    icon: ScrollText,
    stat: 'Zero',
    title: 'answer to “who approved this?”',
    body: 'When a client asks who signed off, scattered Slack threads and inbox rules can’t tell you. No record of who sent what, when, or why.',
  },
];

export function CostSection() {
  return (
    <section className="relative overflow-hidden bg-ink py-section text-white">
      <FloatingDecor variant="b" />
      <div className="bg-glow-brand animate-drift-slow pointer-events-none absolute -right-32 top-0 h-[36vw] w-[36vw] rounded-full blur-[140px] opacity-50" />
      <Container className="relative z-10">
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand-400">The real cost</p>
          <h2 className="font-display text-display2 font-semibold">
            Ungoverned outreach doesn’t save time. <span className="italic text-brand-400">It costs you a domain.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-white/60">
            Let junior staff and clients send across dozens of mailboxes with no checkpoint, and the failures are
            expensive — and hard to undo.
          </p>
        </Reveal>

        <div className="grid gap-6 md:grid-cols-3">
          {COSTS.map((c, i) => (
            <Reveal key={c.title} delay={i * 90}>
              <div className="lift h-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm transition hover:border-white/25">
                <span className="mb-6 grid h-13 w-13 place-items-center rounded-2xl bg-white/10 p-3 text-brand-400">
                  <c.icon size={24} />
                </span>
                <p className="font-grotesk text-3xl font-bold tracking-tightest text-brand-400">{c.stat}</p>
                <h3 className="mb-3 mt-1 font-display text-xl font-semibold">{c.title}</h3>
                <p className="text-[15px] leading-relaxed text-white/60">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-12 text-center">
          <p className="text-lg font-semibold text-white/80">
            Grapme puts <span className="text-brand-400">one approval gate</span> in front of all of it.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
