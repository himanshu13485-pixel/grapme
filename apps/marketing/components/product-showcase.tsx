'use client';

import { useState } from 'react';
import { Reveal } from './reveal';
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

function BrowserFrame({ shot }: { shot: Shot }) {
  const [errored, setErrored] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card transition-transform duration-300 hover:-translate-y-1">
      <div className="flex items-center gap-2 border-b border-line bg-mist/70 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff6159]" />
        <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 rounded-md bg-paper px-3 py-1 text-xs font-semibold text-faint">app.grapme.com/portal</span>
      </div>
      {errored ? (
        <div className="grid aspect-[16/8] place-items-center bg-mist/40 p-6 text-center">
          <div>
            <p className="font-grotesk text-sm font-bold text-ink">Add screenshot</p>
            <p className="mt-1 text-xs text-muted">
              Drop the image at <code className="rounded bg-line/60 px-1">public{shot.src}</code>
            </p>
          </div>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.src} alt={shot.title} loading="lazy" onError={() => setErrored(true)} className="block w-full" />
      )}
    </div>
  );
}

export function ProductShowcase() {
  return (
    <div className="flex flex-col gap-14 lg:gap-16">
      {SHOTS.map((shot, i) => {
        const flip = i % 2 === 1;
        return (
          <div key={shot.src} className="grid items-center gap-6 lg:grid-cols-12 lg:gap-10">
            {/* caption */}
            <Reveal delay={60} className={`lg:col-span-4 ${flip ? 'lg:order-2 lg:pl-2' : 'lg:pr-2'}`}>
              <Badge>{shot.tag}</Badge>
              <h3 className="mb-3 mt-5 font-display text-display3 font-semibold text-ink">{shot.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{shot.body}</p>
              <p className="mt-4 font-grotesk text-eyebrow font-semibold uppercase text-faint">
                0{i + 1} / 0{SHOTS.length}
              </p>
            </Reveal>

            {/* framed screenshot with a soft colour glow behind it */}
            <Reveal delay={140} className={`relative lg:col-span-8 ${flip ? 'lg:order-1' : ''}`}>
              <div className={`${shot.glow} pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] opacity-50 blur-2xl`} />
              <BrowserFrame shot={shot} />
            </Reveal>
          </div>
        );
      })}
    </div>
  );
}
