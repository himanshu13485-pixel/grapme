import Link from 'next/link';
import {
  ArrowUpRight,
  ShieldCheck,
  Users,
  Mail,
  Linkedin,
  MessageSquare,
  BarChart3,
  Lock,
  FileCheck2,
  Gauge,
} from 'lucide-react';
import { Container } from '@/components/container';
import { LeadForm } from '@/components/lead-form';
import { HeroPanel } from '@/components/hero-panel';
import { Reveal } from '@/components/reveal';
import { Parallax } from '@/components/parallax';
import { Magnetic } from '@/components/magnetic';
import { CountUp } from '@/components/count-up';
import { PersonalGreeting } from '@/components/personal-greeting';
import { VideoBackground } from '@/components/video-background';
import { AnimatedHeadline } from '@/components/animated-headline';
import { ScrollCue } from '@/components/scroll-cue';
import { RotatingWord } from '@/components/rotating-word';
import { OrbitAvatars } from '@/components/orbit-avatars';
import { TiltCard } from '@/components/tilt-card';
import { Sparkle } from '@/components/sparkle';
import { FloatingDecor } from '@/components/floating-decor';
import { CostSection } from '@/components/cost-section';
import { PersonasSection } from '@/components/personas-section';
import { StickyShowcase } from '@/components/sticky-showcase';
import { LifecycleFlow } from '@/components/lifecycle-flow';
import { FunnelChart, TrendChart, ChannelDonut } from '@/components/mini-charts';
import { MediaVideo, MediaPhoto } from '@/components/media-strip';
import { getAllPosts } from '@/lib/posts';
import { SITE, SITE_URL } from '@/lib/site';

const TRUST = [
  { icon: Lock, label: 'AES-256-GCM at rest' },
  { icon: FileCheck2, label: 'Argon2id password hashing' },
  { icon: ShieldCheck, label: 'Live SPF / DKIM / DMARC checks' },
  { icon: Gauge, label: 'Immutable audit log' },
];

const CHANNELS = [
  { icon: Linkedin, label: 'LinkedIn', body: 'Your own accounts run connection and messaging sequences at a human, ban-safe pace.' },
  { icon: Mail, label: 'Email', body: 'Connect any SMTP/IMAP mailbox and run cold sequences at warm-up-safe speed.' },
];

const STATS = [
  { big: '2', label: 'channels in one dashboard' },
  { big: 'Minutes', label: 'to launch your first campaign' },
  { big: '0', label: 'agencies needed' },
  { big: '∞', label: 'mailboxes, cleanly isolated' },
];

const OUTCOMES = [
  {
    icon: ShieldCheck,
    title: 'Set up and send in one sitting',
    body: 'Connect a mailbox or LinkedIn account, build your campaign, and launch it yourself — no third party, no waiting on anyone else.',
  },
  {
    icon: Users,
    title: 'Built for teams, not just solo senders',
    body: 'Row-level isolation per user, role-based team access, and per-seat credit allocation — one platform for your whole team, whether it’s just you or a growing crew.',
  },
  {
    icon: BarChart3,
    title: 'Deliverability protected by default',
    body: 'Time-zone aware scheduling, daily send caps, warm-up-friendly jitter, and a live domain check before volume ever touches your mailbox.',
  },
  {
    icon: Lock,
    title: 'Locked down end to end',
    body: 'AES-256-GCM encrypted mailbox credentials, Argon2id password hashing, and an immutable audit log covering every action, every role.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Connect & build',
    body: 'Connect a mailbox or LinkedIn seat, pick a contact list and template, and set your schedule — ready in minutes.',
  },
  {
    n: '02',
    title: 'Launch it yourself',
    body: 'No approval chain, no waiting on someone else. Review your campaign and send it whenever you’re ready.',
  },
  {
    n: '03',
    title: 'Send, track, report',
    body: 'Sends go out with jitter and daily caps for safety. Opens, clicks, replies, and bounces roll up live so you always know what’s working.',
  },
];

export default function HomePage() {
  const posts = getAllPosts().slice(0, 3);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: SITE.description,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden pb-16 pt-12 sm:pt-16">
        {/* animated aurora backdrop (swap for <VideoBackground src="/hero.mp4" />) */}
        <VideoBackground />

        {/* floating decorative shapes */}
        <span
          className="animate-float-shape pointer-events-none absolute left-[5%] top-[22%] hidden h-16 w-16 rounded-2xl border-2 border-brand/30 lg:block"
          style={{ ['--rot' as string]: '-8deg' }}
        />
        <span
          className="animate-float-shape pointer-events-none absolute right-[47%] top-[10%] hidden h-10 w-10 rounded-full bg-teal/25 lg:block"
          style={{ animationDelay: '0.8s' }}
        />
        <span
          className="animate-float-shape pointer-events-none absolute left-[30%] bottom-[14%] hidden h-6 w-6 rotate-45 bg-amber/30 lg:block"
          style={{ animationDelay: '1.6s' }}
        />
        <Sparkle className="pointer-events-none absolute left-[43%] top-[68%] hidden h-7 w-7 text-amber lg:block" delay={300} />
        <Sparkle className="pointer-events-none absolute right-[7%] bottom-[18%] hidden h-9 w-9 text-brand lg:block" delay={700} />
        <Sparkle className="pointer-events-none absolute left-[8%] bottom-[30%] hidden h-6 w-6 text-teal lg:block" delay={1100} />

        <Container className="relative">
          <div className="grid items-center gap-x-12 gap-y-12 lg:grid-cols-[1.05fr,0.95fr]">
            <div className="relative z-20">
              <Reveal>
                <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="inline-flex items-center gap-2.5 rounded-full border border-brand-100 bg-paper/70 px-4 py-2 font-grotesk text-eyebrow font-semibold uppercase text-brand backdrop-blur">
                    <Linkedin size={14} />
                    LinkedIn · Email
                  </p>
                  {/* personalized content */}
                  <PersonalGreeting />
                </div>
              </Reveal>

              <AnimatedHeadline
                className="mb-6 max-w-2xl font-display text-display1 font-semibold text-ink"
                lead="LinkedIn & Email Automation"
                accent="You Run Yourself."
              />

              <Reveal delay={140}>
                <p className="mb-8 font-grotesk text-xl font-bold text-ink/80">
                  Now automating{' '}
                  <RotatingWord words={['LinkedIn', 'cold email']} interval={1800} className="text-brand" />{' '}
                  outreach.
                </p>
              </Reveal>

              <Reveal delay={200}>
                <p className="mb-10 max-w-md text-lg leading-relaxed text-muted">{SITE.description}</p>
              </Reveal>

              <Reveal delay={260}>
                <div className="flex flex-wrap items-center gap-4">
                  <Magnetic>
                    <a
                      href={`${SITE.appUrl}/client?mode=register`}
                      className="btn-shine group inline-flex items-center gap-2 rounded-full bg-ink px-8 py-4 text-[15px] font-bold text-white shadow-glow transition hover:bg-brand active:scale-[0.97]"
                    >
                      Get started
                      <ArrowUpRight size={17} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </a>
                  </Magnetic>
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-paper/70 px-8 py-4 text-[15px] font-bold text-ink backdrop-blur transition hover:border-ink/25"
                  >
                    Book a demo
                  </Link>
                  <Link
                    href="/how-it-works"
                    className="inline-flex items-center gap-2 rounded-full px-4 py-4 text-[15px] font-bold text-muted transition hover:text-ink"
                  >
                    See how it works
                  </Link>
                </div>
              </Reveal>
            </div>

            {/* hero visual: orbit ring + parallax + bold blur-in entrance */}
            <div className="relative z-10">
              <OrbitAvatars />
              <Reveal delay={160}>
                <Parallax speed={0.12}>
                  <div className="animate-blur-in">
                    <HeroPanel />
                  </div>
                </Parallax>
              </Reveal>
            </div>
          </div>
        </Container>

        <ScrollCue />
      </section>

      {/* ============ TRUST STRIP (floating glass bar) ============ */}
      <Container>
        <Reveal className="relative z-10 -mt-4 mb-4">
          <div className="marquee-mask overflow-hidden rounded-2xl border border-line bg-paper/70 py-5 shadow-soft backdrop-blur-md">
            <div className="marquee-track gap-14 px-8">
              {[...TRUST, ...TRUST, ...TRUST, ...TRUST].map((t, i) => (
                <div key={i} className="flex shrink-0 items-center gap-2.5 text-[13.5px] font-semibold text-muted">
                  <t.icon size={16} className="text-brand" />
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </Container>

      {/* ============ THE COST ============ */}
      <CostSection />

      {/* ============ CHANNELS ============ */}
      <section className="relative overflow-hidden py-section">
        <FloatingDecor variant="a" />
        <Container className="relative z-10">
          <Reveal className="mx-auto mb-10 max-w-xl text-center">
            <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">The stack</p>
            <h2 className="font-display text-display2 font-semibold text-ink">
              One dashboard. <span className="italic text-brand">Two channels.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-muted">
              Run and monitor every outreach channel your team uses — without switching tools.
            </p>
          </Reveal>

          <div className="mx-auto grid max-w-3xl gap-7 md:grid-cols-2">
            {CHANNELS.map((c, i) => (
              <Reveal key={c.label} delay={i * 90}>
                <TiltCard max={12} className="group h-full rounded-3xl border border-line bg-paper/80 p-8 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                  <span className="mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand transition-transform group-hover:scale-125 group-hover:-rotate-12">
                    <c.icon size={24} />
                  </span>
                  <h3 className="mb-2 font-display text-2xl font-semibold text-ink">{c.label}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{c.body}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ============ STATS (floating dark panel) ============ */}
      <section className="py-section">
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-ink px-8 py-16 text-white shadow-glow sm:px-14">
              <div className="noise-dark pointer-events-none absolute inset-0" />
              <div className="bg-glow-brand animate-drift-slow pointer-events-none absolute -left-10 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full blur-[120px]" />
              <div className="relative z-10 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
                {STATS.map((s, i) => (
                  <Reveal key={s.label} delay={i * 80}>
                    <div className="border-l border-white/15 pl-5">
                      <p className="font-grotesk text-6xl font-bold leading-none tracking-tightest text-brand-400">
                        <CountUp value={s.big} />
                      </p>
                      <p className="mt-4 text-sm text-white/60">{s.label}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* ============ WHY ============ */}
      <section className="relative overflow-hidden py-section">
        <FloatingDecor variant="b" />
        <Container className="relative z-10">
          <Reveal className="mx-auto mb-10 max-w-2xl text-center">
            <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">Why {SITE.name}</p>
            <h2 className="font-display text-display2 font-semibold text-ink">
              Run your own outreach, <span className="italic text-brand">without the guesswork.</span>
            </h2>
          </Reveal>

          <div className="mx-auto grid max-w-5xl gap-7 md:grid-cols-2">
            {OUTCOMES.map((o, i) => (
              <Reveal key={o.title} delay={i * 80}>
                <TiltCard max={10} className="group h-full rounded-3xl border border-line bg-paper/80 p-9 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                  <span className="mb-7 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand transition-transform group-hover:scale-125 group-hover:-rotate-12">
                    <o.icon size={24} />
                  </span>
                  <h3 className="mb-3 font-display text-2xl font-semibold text-ink">{o.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{o.body}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ============ WHO IT'S FOR ============ */}
      <PersonasSection />

      {/* ============ PRODUCT SHOWCASE ============ */}
      {/* no overflow-hidden here: it would break the sticky-scroll showcase */}
      <section className="relative py-section">
        <FloatingDecor variant="d" />
        <div className="relative z-10 mx-auto w-full max-w-[92rem] px-6 lg:px-10">
          <Reveal className="mx-auto mb-10 max-w-2xl text-center">
            <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">See it in action</p>
            <h2 className="font-display text-display2 font-semibold text-ink">
              The whole engine, <span className="italic text-brand">visualised</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-muted">
              From building a campaign to live analytics to the real product screens — here&apos;s how it all fits.
            </p>
          </Reveal>

          {/* flowchart */}
          <Reveal className="mb-10">
            <LifecycleFlow />
          </Reveal>

          {/* charts bento — equal-height cards */}
          <div className="mb-12 grid items-stretch gap-5 lg:grid-cols-3">
            <Reveal delay={0} className="h-full">
              <FunnelChart />
            </Reveal>
            <Reveal delay={90} className="h-full">
              <TrendChart />
            </Reveal>
            <Reveal delay={180} className="h-full">
              <ChannelDonut />
            </Reveal>
          </div>

          {/* screenshots — pinned scroll-through showcase */}
          <StickyShowcase />

          {/* media — video leads, photo matches its height */}
          <div className="mt-14 grid items-stretch gap-6 md:grid-cols-[1.55fr,1fr]">
            <Reveal className="h-full">
              <MediaVideo />
            </Reveal>
            <Reveal delay={120} className="h-full">
              <MediaPhoto />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="relative overflow-hidden py-section">
        <FloatingDecor variant="c" />
        <Container className="relative z-10">
          <Reveal className="mx-auto mb-12 max-w-xl text-center">
            <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">The lifecycle</p>
            <h2 className="font-display text-display2 font-semibold text-ink">
              From draft to sent in <span className="italic text-brand">three</span> checkpoints
            </h2>
          </Reveal>

          <div className="mx-auto grid max-w-5xl gap-x-10 gap-y-12 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 110}>
                <TiltCard max={8} className="group h-full rounded-3xl border border-line bg-paper/70 p-7 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card">
                  <span className="font-grotesk text-5xl font-bold leading-none tracking-tightest text-brand/30 transition-colors group-hover:text-brand">
                    {s.n}
                  </span>
                  <h3 className="mb-2.5 mt-5 font-display text-xl font-semibold text-ink">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200} className="mt-16 text-center">
            <Link href="/how-it-works" className="group inline-flex items-center gap-1.5 font-bold text-brand hover:underline">
              Walk through the full lifecycle
              <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Reveal>
        </Container>
      </section>

      {/* ============ BLOG ============ */}
      {posts.length > 0 && (
        <section className="relative overflow-hidden py-section">
          <FloatingDecor variant="d" />
          <Container className="relative z-10">
            <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-4 font-grotesk text-eyebrow font-semibold uppercase text-brand">Field notes</p>
                <h2 className="font-display text-display2 font-semibold text-ink">From the blog</h2>
              </div>
              <Link href="/blog" className="font-bold text-brand hover:underline">
                View all posts →
              </Link>
            </Reveal>

            <div className="grid gap-7 md:grid-cols-3">
              {posts.map((post, i) => (
                <Reveal key={post.slug} delay={i * 90}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="lift group flex h-full flex-col rounded-3xl border border-line bg-paper/80 p-8 shadow-soft backdrop-blur-sm hover:border-brand/40 hover:shadow-card"
                  >
                    <p className="mb-5 font-grotesk text-eyebrow font-semibold uppercase text-faint">{post.date}</p>
                    <h3 className="mb-3 font-display text-xl font-semibold leading-snug text-ink">{post.title}</h3>
                    <p className="mb-7 text-[15px] leading-relaxed text-muted">{post.description}</p>
                    <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-bold text-brand">
                      Read <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* ============ FINAL CTA ============ */}
      <section className="relative overflow-hidden py-section">
        <FloatingDecor variant="b" />
        <Container className="relative z-10">
          <Reveal className="mx-auto mb-9 max-w-2xl text-center">
            <h2 className="font-display text-display2 font-semibold text-ink">
              See it running <span className="italic text-brand">your</span> next campaign
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-muted">Tell us about your team and we&apos;ll set up a walkthrough.</p>
          </Reveal>
          <Reveal delay={120} className="mx-auto max-w-4xl">
            <LeadForm heading="Book a demo" sub="Leave your details and our team will reach out." />
          </Reveal>
        </Container>
      </section>
    </>
  );
}
