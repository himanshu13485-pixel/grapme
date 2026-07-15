import { LiveDot } from './live-dot';

export function HeroPanel() {
  const rows = [
    {
      title: 'Q3 Outreach — Meridian Co.',
      meta: 'Email · 480 contacts · 2h ago',
      status: 'Sending',
      tone: 'teal' as const,
    },
    {
      title: 'LinkedIn Connector — Vantage',
      meta: 'LinkedIn · 210 profiles · 5h ago',
      status: 'Live',
      tone: 'teal' as const,
    },
    {
      title: 'Follow-up Seq — Orbital',
      meta: 'Email · 3 steps · 1d ago',
      status: 'Scheduled',
      tone: 'amber' as const,
    },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[470px]">
      <div className="bg-glow-brand animate-drift absolute -inset-8 -z-10 rounded-[3rem] blur-3xl opacity-70" />

      {/* floating live status pill */}
      <div className="animate-float-soft absolute -right-3 -top-5 z-20 flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2 shadow-card">
        <LiveDot label="" />
        <span className="text-xs font-bold text-ink">3 campaigns sending</span>
      </div>

      <div className="animate-float-slow rounded-2xl border border-line bg-paper p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff6159]" />
            <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex items-center gap-3">
            <LiveDot label="Live" />
            <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-bold text-muted">Campaign Center</span>
          </div>
        </div>

        {rows.map((r) => (
          <div
            key={r.title}
            className="lift mb-2.5 flex items-center justify-between rounded-xl border border-line bg-mist px-4 py-3 hover:border-brand/40 hover:bg-brand-50/50"
          >
            <div>
              <p className="text-[13px] font-bold text-ink">{r.title}</p>
              <p className="text-xs text-muted">{r.meta}</p>
            </div>
            {r.tone === 'amber' ? (
              <span className="animate-pulse-ring rounded-full bg-amber-light px-2.5 py-1 text-[11px] font-bold text-amber">
                {r.status}
              </span>
            ) : (
              <span className="rounded-full bg-teal-light px-2.5 py-1 text-[11px] font-bold text-teal">{r.status}</span>
            )}
          </div>
        ))}

        <div className="mt-3 flex items-center justify-between border-t border-line pt-4">
          <div className="flex -space-x-2">
            {['#4f46e5', '#0fb894', '#f59e0b'].map((c) => (
              <span key={c} className="h-7 w-7 rounded-full border-2 border-paper" style={{ background: c }} />
            ))}
          </div>
          <div className="text-right">
            <p className="font-grotesk text-lg font-bold text-ink">98.4%</p>
            <p className="text-[11px] text-muted">inbox delivery rate</p>
          </div>
        </div>
      </div>

      {/* floating stat card */}
      <div
        className="animate-float-soft absolute -bottom-8 -left-6 hidden w-44 rounded-xl border border-line bg-paper p-4 shadow-card sm:block"
        style={{ ['--rot' as string]: '-2deg' }}
      >
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Reply rate</p>
        <p className="font-grotesk text-2xl font-bold text-ink">
          32.6% <span className="text-xs font-bold text-teal">↑ 6.1%</span>
        </p>
        <div className="mt-3 flex h-8 items-end gap-1">
          {[40, 55, 35, 70, 60, 85, 65].map((h, i) => (
            <span
              key={i}
              className="bar-grow w-full rounded-sm bg-brand-100"
              style={{ height: `${h}%`, animationDelay: `${0.6 + i * 0.09}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
