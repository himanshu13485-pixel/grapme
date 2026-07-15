'use client';

import { Fragment, useState } from 'react';
import { FileEdit, Rocket, CalendarClock, Send, MessageSquareReply, ArrowRight } from 'lucide-react';

const NODES = [
  {
    icon: FileEdit,
    label: 'Draft',
    sub: 'You build freely',
    detail:
      'Assemble the campaign — mailbox or LinkedIn seat, contact list, template, and follow-up steps — and save it. Fully editable, and nothing sends yet.',
  },
  {
    icon: Rocket,
    label: 'Launch',
    sub: 'You control it',
    detail:
      'When you’re ready, launch the campaign yourself — no approval chain, no waiting on anyone else. It goes live exactly as you configured it.',
  },
  {
    icon: CalendarClock,
    label: 'Schedule',
    sub: 'Tz + daily cap',
    detail:
      'Campaigns land on a timezone-aware calendar with a daily send cap and warm-up-friendly jitter between each send, to protect the domain.',
  },
  {
    icon: Send,
    label: 'Send',
    sub: 'Warm-up jitter',
    detail:
      'Workers dispatch each message from the assigned mailbox, rewrite tracking and unsubscribe links, and record every open, click and bounce as it happens.',
  },
  {
    icon: MessageSquareReply,
    label: 'Reply',
    sub: 'Auto-stops sequence',
    detail:
      'Inbound replies are threaded and matched back to the contact — which automatically stops their follow-up sequence and surfaces the message in the unified inbox.',
  },
];

export function LifecycleFlow() {
  const [active, setActive] = useState(0);

  return (
    <div className="rounded-3xl border border-line bg-paper/70 p-6 shadow-soft backdrop-blur-sm sm:p-8">
      {/* interactive node row — nodes are equal-width, arrows sit between them */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0">
        {NODES.map((n, i) => {
          const isActive = i === active;
          const Icon = n.icon;
          return (
            <Fragment key={n.label}>
              <button
                onClick={() => setActive(i)}
                aria-pressed={isActive}
                className={`group relative flex-1 rounded-2xl border-2 p-4 text-left transition-all duration-300 lg:text-center ${
                  isActive
                    ? 'border-brand bg-brand-50 text-ink shadow-card'
                    : 'border-line bg-paper text-ink hover:-translate-y-1 hover:border-brand/40 hover:shadow-soft'
                }`}
              >
                <div className="flex items-center gap-3 lg:flex-col">
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl transition ${
                      isActive ? 'bg-brand text-white' : 'bg-brand-50 text-brand'
                    }`}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="lg:mt-1">
                    <p className="text-sm font-bold leading-tight">{n.label}</p>
                    <p className="text-xs text-muted">{n.sub}</p>
                  </div>
                </div>
              </button>

              {i < NODES.length - 1 && (
                <div className="flex items-center justify-center py-1 lg:px-1.5">
                  <ArrowRight
                    size={20}
                    className={`rotate-90 text-brand/40 lg:rotate-0 ${active === i ? 'animate-arrow text-brand' : ''}`}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* detail panel for the active stage */}
      <div className="mt-7 flex items-start gap-4 rounded-2xl border border-line bg-mist/50 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white">
          {(() => {
            const Icon = NODES[active].icon;
            return <Icon size={18} />;
          })()}
        </span>
        <div>
          <p className="mb-1 font-display text-lg font-semibold text-ink">
            {NODES[active].label}{' '}
            <span className="text-sm font-normal text-muted">
              · step {active + 1} of {NODES.length}
            </span>
          </p>
          <p className="text-sm leading-relaxed text-muted">{NODES[active].detail}</p>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-faint">Tap a stage to see what happens there.</p>
    </div>
  );
}
