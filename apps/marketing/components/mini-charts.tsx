/* Original data-viz for the product showcase. Brand categorical order:
   indigo (#5b6bff) → teal (#0fb894) → amber (#f59e0b). Text stays in ink tokens. */

// ---------- Funnel: Sent → Delivered → Opened → Replied ----------
export function FunnelChart() {
  const rows = [
    { label: 'Sent', value: 102, pct: 100, shade: '#4f46e5' },
    { label: 'Delivered', value: 102, pct: 100, shade: '#5b6bff' },
    { label: 'Opened', value: 68, pct: 67, shade: '#7c8bff' },
    { label: 'Replied', value: 31, pct: 30, shade: '#a9b0ff' },
  ];
  return (
    <div className="flex h-full flex-col rounded-3xl border border-line bg-paper/80 p-7 shadow-soft backdrop-blur-sm">
      <p className="mb-1 font-grotesk text-eyebrow font-semibold uppercase text-brand">Conversion funnel</p>
      <h3 className="mb-6 font-display text-xl font-semibold text-ink">Sent to replied</h3>
      <div className="flex flex-col gap-4">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-semibold text-ink">{r.label}</span>
              <span className="font-grotesk font-bold text-ink">{r.value}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-mist">
              <div
                className="bar-grow-x h-full rounded-full"
                style={{ width: `${r.pct}%`, background: r.shade, animationDelay: `${i * 140}ms` }}
                title={`${r.label}: ${r.value} (${r.pct}%)`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Trend: sends vs replies over 6 weeks ----------
export function TrendChart() {
  const W = 320;
  const H = 150;
  const P = 8;
  const sends = [12, 18, 15, 22, 26, 31];
  const replies = [3, 5, 4, 7, 9, 11];
  const max = 34;
  const x = (i: number) => P + (i * (W - 2 * P)) / (sends.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = (arr: number[]) => `${line(arr)} L${x(arr.length - 1)},${H - P} L${x(0)},${H - P} Z`;

  return (
    <div className="flex h-full flex-col rounded-3xl border border-line bg-paper/80 p-7 shadow-soft backdrop-blur-sm">
      <p className="mb-1 font-grotesk text-eyebrow font-semibold uppercase text-brand">Momentum</p>
      <h3 className="mb-4 font-display text-xl font-semibold text-ink">Sends &amp; replies / week</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sends and replies per week">
        <defs>
          <linearGradient id="fillSends" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b6bff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#5b6bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.5].map((g) => (
          <line key={g} x1={P} x2={W - P} y1={H * g} y2={H * g} stroke="#e5e8f2" strokeWidth="1" />
        ))}
        <path d={area(sends)} fill="url(#fillSends)" />
        <path
          d={line(sends)}
          fill="none"
          stroke="#5b6bff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="draw-line"
          style={{ strokeDasharray: 400, strokeDashoffset: 400 }}
        />
        <path
          d={line(replies)}
          fill="none"
          stroke="#0fb894"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="draw-line"
          style={{ strokeDasharray: 400, strokeDashoffset: 400, animationDelay: '0.3s' }}
        />
        <circle cx={x(5)} cy={y(sends[5])} r="4" fill="#5b6bff" stroke="#fff" strokeWidth="2" />
        <circle cx={x(5)} cy={y(replies[5])} r="4" fill="#0fb894" stroke="#fff" strokeWidth="2" />
      </svg>
      <div className="mt-3 flex gap-5 text-xs font-semibold">
        <span className="flex items-center gap-1.5 text-ink"><span className="h-2 w-2 rounded-full bg-[#5b6bff]" /> Sends</span>
        <span className="flex items-center gap-1.5 text-ink"><span className="h-2 w-2 rounded-full bg-teal" /> Replies</span>
      </div>
    </div>
  );
}

// ---------- Donut: channel mix ----------
export function ChannelDonut() {
  const data = [
    { label: 'Email', value: 65, color: '#5b6bff' },
    { label: 'LinkedIn', value: 35, color: '#0fb894' },
  ];
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex h-full flex-col rounded-3xl border border-line bg-paper/80 p-7 shadow-soft backdrop-blur-sm">
      <p className="mb-1 font-grotesk text-eyebrow font-semibold uppercase text-brand">Channel mix</p>
      <h3 className="mb-4 font-display text-xl font-semibold text-ink">Where sends go</h3>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0 -rotate-90">
          {data.map((d) => {
            const len = (d.value / 100) * C;
            const seg = (
              <circle
                key={d.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              >
                <title>{`${d.label}: ${d.value}%`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </svg>
        <ul className="flex flex-col gap-2.5 text-sm">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
              <span className="font-semibold text-ink">{d.label}</span>
              <span className="font-grotesk font-bold text-muted">{d.value}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
