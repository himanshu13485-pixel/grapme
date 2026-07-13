import { Sparkle } from './sparkle';

/**
 * Drop-in decorative motion: a few floating shapes + sparkles positioned near
 * the edges of a section. Place as the first child of a `relative` section
 * (it's absolutely positioned + pointer-events-none, so it never blocks clicks).
 */
export function FloatingDecor({ variant = 'a' }: { variant?: 'a' | 'b' | 'c' | 'd' }) {
  const sets = {
    a: (
      <>
        <span className="animate-float-shape absolute left-[4%] top-[18%] h-12 w-12 rounded-2xl border-2 border-brand/25" style={{ ['--rot' as string]: '-10deg' }} />
        <span className="animate-float-shape absolute right-[6%] bottom-[14%] h-8 w-8 rounded-full bg-teal/20" style={{ animationDelay: '0.9s' }} />
        <Sparkle className="absolute right-[12%] top-[22%] h-6 w-6 text-amber" delay={400} />
      </>
    ),
    b: (
      <>
        <span className="animate-float-shape absolute right-[5%] top-[16%] h-10 w-10 rotate-45 bg-brand/15" style={{ animationDelay: '0.4s' }} />
        <span className="animate-float-shape absolute left-[7%] bottom-[18%] h-9 w-9 rounded-full border-2 border-amber/30" style={{ animationDelay: '1.3s' }} />
        <Sparkle className="absolute left-[14%] top-[26%] h-7 w-7 text-brand" delay={700} />
      </>
    ),
    c: (
      <>
        <span className="animate-float-shape absolute left-[6%] top-[24%] h-8 w-8 rounded-full bg-amber/20" style={{ animationDelay: '0.2s' }} />
        <span className="animate-float-shape absolute right-[8%] top-[30%] h-11 w-11 rounded-2xl border-2 border-teal/30" style={{ ['--rot' as string]: '8deg' }} />
        <Sparkle className="absolute right-[16%] bottom-[16%] h-6 w-6 text-teal" delay={500} />
      </>
    ),
    d: (
      <>
        <span className="animate-float-shape absolute right-[6%] bottom-[20%] h-12 w-12 rotate-12 rounded-2xl bg-brand/10" style={{ animationDelay: '0.6s' }} />
        <Sparkle className="absolute left-[10%] top-[20%] h-7 w-7 text-amber" delay={300} />
        <Sparkle className="absolute right-[14%] top-[30%] h-5 w-5 text-brand" delay={1000} />
      </>
    ),
  };

  return <div aria-hidden className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden lg:block">{sets[variant]}</div>;
}
