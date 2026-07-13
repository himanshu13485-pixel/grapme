'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Microinteraction: counts a numeric value up when it scrolls into view.
 * Preserves any non-numeric prefix/suffix (e.g. "100%"). Non-numeric
 * values (e.g. "∞") render as-is.
 */
export function CountUp({ value, className = '' }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const parts = value.match(/^(\D*)(\d+)(\D*)$/);
  const [display, setDisplay] = useState(parts ? `${parts[1]}0${parts[3]}` : value);

  useEffect(() => {
    if (!parts) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const pre = parts[1];
    const target = parseInt(parts[2], 10);
    const suf = parts[3];

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(`${pre}${target}${suf}`);
      return;
    }

    let started = false;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          started = true;
          const dur = 1100;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            setDisplay(`${pre}${Math.round(target * eased)}${suf}`);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
