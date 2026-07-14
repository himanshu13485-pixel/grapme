import { Building2, Handshake, Target, Users } from 'lucide-react';
import { Container } from './container';
import { Reveal } from './reveal';
import { FloatingDecor } from './floating-decor';

const PERSONAS = [
  {
    icon: Building2,
    title: 'Lead-gen agencies',
    body: 'Run cold outreach for a roster of clients — each one isolated, each campaign approved before it sends.',
    tags: ['Multi-client', 'Per-client isolation'],
  },
  {
    icon: Handshake,
    title: 'Managed-service providers',
    body: 'Operate mailboxes, sequences and reporting for clients who never have to touch the tool themselves.',
    tags: ['Done-for-you', 'Client reports'],
  },
  {
    icon: Target,
    title: 'Sales teams with sign-off',
    body: 'Let SDRs build campaigns freely while a manager approves every launch — no rogue sends from the pipeline.',
    tags: ['Manager approval', 'RevOps'],
  },
  {
    icon: Users,
    title: 'Recruiting & staffing',
    body: 'Source and message candidates at volume without ever risking the firm’s sending domains.',
    tags: ['Candidate outreach', 'Volume-safe'],
  },
];

export function PersonasSection() {
  return (
    <section className="relative overflow-hidden py-section">
      <FloatingDecor variant="c" />
      <Container className="relative z-10">
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">Who it’s for</p>
          <h2 className="font-display text-display2 font-semibold text-ink">
            Built for teams that send <span className="italic text-brand">on behalf of others</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-muted">
            Anywhere one team runs outreach for many accounts, an approval gate is the difference between scaling and
            scrambling.
          </p>
        </Reveal>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <div className="lift group h-full rounded-3xl border border-line bg-paper/80 p-7 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                <span className="mb-6 grid h-13 w-13 place-items-center rounded-2xl bg-brand-50 p-3 text-brand transition-transform group-hover:-rotate-6">
                  <p.icon size={24} />
                </span>
                <h3 className="mb-2 font-display text-xl font-semibold text-ink">{p.title}</h3>
                <p className="mb-5 text-[14px] leading-relaxed text-muted">{p.body}</p>
                <div className="flex flex-wrap gap-2">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-bold text-muted">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
