'use client';

import { useState } from 'react';
import { Reveal } from './reveal';
import { Badge } from './badge';

type Shot = { src: string; tag: string; title: string; body: string; glow: string };

const SHOTS: Shot[] = [
  {
    src: '/screens/dashboard.png',
    tag: 'Client dashboard',
    title: 'Every metric at a glance',
    body: 'Active cohorts, emails sent, delivery, open, reply and forward rates — each client sees their whole outreach in one clean, read-only portal.',
    glow: 'bg-glow-brand',
  },
  {
    src: '/screens/mailboxes.png',
    tag: 'Deliverability',
    title: 'Mailboxes scored on SPF, DKIM & DMARC',
    body: 'Every mailbox is auth-scored out of 100, with live DNS checks, connection and inbox tests, and a per-mailbox daily cap — before a single email goes out.',
    glow: 'bg-glow-teal',
  },
  {
    src: '/screens/cohorts.png',
    tag: 'Automation',
    title: 'Manual and auto-monthly cohorts',
    body: 'Upload a cohort from any contact list, or let the system auto-build a fresh cohort every month — plus scheduled performance reports to the client.',
    glow: 'bg-glow-amber',
  },
  {
    src: '/screens/schedule.png',
    tag: 'Scheduling',
    title: 'A forward agenda of every send',
    body: 'Running cohorts with a day-by-day forecast of every initial and follow-up wave, in date order — so nothing sends unseen.',
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
