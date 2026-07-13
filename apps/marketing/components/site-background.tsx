import { Parallax } from './parallax';

/** Site-wide animated background — bold, always-moving blooms + spinning geometry. */
export function SiteBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* gradient wash */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f7f8fe_0%,#eef1fb_45%,#f4f6fd_100%)]" />

      {/* fast, bold colour blooms */}
      <Parallax mode="scroll" speed={-0.1}>
        <div className="bg-glow-brand animate-drift absolute -left-40 -top-40 h-[48vw] w-[48vw] rounded-full blur-[120px] opacity-70" />
        <div className="bg-glow-teal animate-drift-slow absolute right-[-12vw] top-[34vh] h-[38vw] w-[38vw] rounded-full blur-[120px] opacity-60" />
        <div className="bg-glow-amber animate-drift absolute bottom-[-12vw] left-[24vw] h-[34vw] w-[34vw] rounded-full blur-[120px] opacity-55" />
      </Parallax>

      {/* spinning concentric rings, top-right */}
      <Parallax mode="scroll" speed={-0.24}>
        <svg
          className="animate-spin-slow absolute -right-28 -top-28 h-[560px] w-[560px] text-brand/15"
          viewBox="0 0 520 520"
          fill="none"
        >
          <circle cx="260" cy="260" r="259" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="260" cy="260" r="200" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="260" cy="260" r="140" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 10" />
        </svg>
      </Parallax>

      {/* dotted grid, lower-left */}
      <Parallax mode="scroll" speed={0.18}>
        <svg className="absolute bottom-20 left-6 h-48 w-64 text-ink/12" viewBox="0 0 224 160" fill="none">
          <defs>
            <pattern id="bg-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="2" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="224" height="160" fill="url(#bg-dots)" />
        </svg>
      </Parallax>

      {/* counter-spinning arc, mid-right */}
      <Parallax mode="scroll" speed={0.28}>
        <svg
          className="animate-spin-slow absolute right-[6vw] top-[58vh] h-72 w-72 text-teal/25 [animation-direction:reverse]"
          viewBox="0 0 256 256"
          fill="none"
        >
          <path d="M8 128a120 120 0 0 1 240 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </Parallax>

      {/* noise overlay */}
      <div className="noise absolute inset-0" />
    </div>
  );
}
