'use client';

import { ReactNode, useEffect, useRef } from 'react';

/**
 * Scroll parallax. Two modes:
 *  - "center" (default): in-flow element drifts as it passes the viewport center.
 *  - "scroll": for fixed/background layers — offset tracks raw scrollY.
 */
export function Parallax({
  children,
  speed = 0.12,
  mode = 'center',
  className = '',
}: {
  children: ReactNode;
  speed?: number;
  mode?: 'center' | 'scroll';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      let y: number;
      if (mode === 'scroll') {
        y = window.scrollY * speed;
      } else {
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2 - window.innerHeight / 2;
        y = -center * speed;
      }
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
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
  }, [speed, mode]);

  return (
    <div ref={ref} className={className} style={{ willChange: 'transform' }}>
      {children}
    </div>
  );
}
