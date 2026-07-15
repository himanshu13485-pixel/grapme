'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from './badge';

type Shot = { src: string; tag: string; title: string; body: string; glow: string };

const SHOTS: Shot[] = [
  {
    src: '/screens/dashboard.png',
    tag: 'Your dashboard',
    title: 'Every metric at a glance',
    body: 'Emails sent, delivered, opened, replied, and forwarded — every rate updated live the moment you open the dashboard.',
    glow: 'bg-glow-brand',
  },
  {
    src: '/screens/linkedin.png',
    tag: 'Multi-channel',
    title: 'Email and LinkedIn, side by side',
    body: 'LinkedIn invites, acceptance, and reply rates sit right below your email numbers — plus a live view of every running cohort. One dashboard, both channels.',
    glow: 'bg-glow-teal',
  },
  {
    src: '/screens/targeting.png',
    tag: 'Targeting & limits',
    title: 'Built-in targeting, safe by default',
    body: 'Set the industries, company sizes, and job titles you want to reach — and a send window, daily cap, and warm-up ramp that keep every campaign at a human, ban-safe pace.',
    glow: 'bg-glow-amber',
  },
  {
    src: '/screens/cohorts.png',
    tag: 'Automation',
    title: 'Manual and auto-monthly cohorts',
    body: 'Upload a cohort from any contact list, or let the system auto-build a fresh one every month — plus scheduled performance reports sent automatically.',
    glow: 'bg-glow-brand',
  },
];

function Frame({ shot, className = '' }: { shot: Shot; className?: string }) {
  const [errored, setErrored] = useState(false);
  return (
    <div className={`overflow-hidden rounded-2xl border border-line bg-paper shadow-card ${className}`}>
      <div className="flex items-center gap-2 border-b border-line bg-mist/70 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff6159]" />
        <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 rounded-md bg-paper px-3 py-1 text-xs font-semibold text-faint">app.grapme.com/portal</span>
      </div>
      {errored ? (
        <div className="grid aspect-[16/8] place-items-center bg-mist/40 p-6 text-center text-sm text-muted">
          Add <code className="rounded bg-line/60 px-1">public{shot.src}</code>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.src} alt={shot.title} onError={() => setErrored(true)} className="block w-full" />
      )}
    </div>
  );
}

export function StickyShowcase() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const flip = active % 2 === 1; // odd steps: image left, text right

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    if (window.matchMedia('(max-width: 1023px)').matches) return; // pin on lg+ only

    let raf = 0;
    const update = () => {
      raf = 0;
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-el.getBoundingClientRect().top, 0), Math.max(total, 1));
      const p = total > 0 ? scrolled / total : 0;
      setActive(Math.min(SHOTS.length - 1, Math.floor(p * SHOTS.length)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const jumpTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    const y = window.scrollY + el.getBoundingClientRect().top + ((i + 0.5) / SHOTS.length) * total;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const shot = SHOTS[active];

  return (
    <>
      {/* ---------- Desktop: pinned scroll, sides alternate per step ---------- */}
      <div ref={trackRef} className="relative hidden lg:block" style={{ height: `${SHOTS.length * 80}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div
            className={`mx-auto flex w-full max-w-[110rem] items-center gap-8 px-2 xl:gap-12 ${
              flip ? 'flex-row-reverse' : ''
            }`}
          >
            {/* text — narrower so the image can dominate */}
            <div className="w-[24%] shrink-0">
              <div key={active} className="fade-step">
                <Badge>{shot.tag}</Badge>
                <p className="mt-6 font-grotesk text-eyebrow font-semibold uppercase text-faint">
                  0{active + 1} <span className="text-line">/ 0{SHOTS.length}</span>
                </p>
                <h3 className="mt-3 font-display text-[clamp(2rem,2.6vw,3rem)] font-semibold leading-[1.08] text-ink">
                  {shot.title}
                </h3>
                <p className="mt-5 text-xl leading-relaxed text-muted">{shot.body}</p>
              </div>

              {/* step bars */}
              <div className="mt-9 flex gap-2.5">
                {SHOTS.map((s, i) => (
                  <button
                    key={s.src}
                    aria-label={s.title}
                    onClick={() => jumpTo(i)}
                    className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                      i === active ? 'bg-brand' : 'bg-line hover:bg-faint'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* image — takes the rest of the row, so it's large either side */}
            <div className="relative flex-1">
              <div
                className={`${shot.glow} pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] opacity-50 blur-3xl transition-all duration-700`}
              />
              {SHOTS.map((s, i) => (
                <Frame
                  key={s.src}
                  shot={s}
                  className={`transition-all duration-500 ease-out ${i === 0 ? 'relative' : 'absolute inset-0'} ${
                    i === active ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-4 scale-[0.97] opacity-0'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Mobile: simple stack ---------- */}
      <div className="flex flex-col gap-12 lg:hidden">
        {SHOTS.map((s) => (
          <div key={s.src}>
            <Badge>{s.tag}</Badge>
            <h3 className="mb-3 mt-4 font-display text-[2rem] font-semibold leading-tight text-ink">{s.title}</h3>
            <p className="mb-5 text-lg leading-relaxed text-muted">{s.body}</p>
            <Frame shot={s} />
          </div>
        ))}
      </div>
    </>
  );
}
