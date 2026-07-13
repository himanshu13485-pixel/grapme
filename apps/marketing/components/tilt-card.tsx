'use client';

import { ReactNode, useRef, MouseEvent } from 'react';

/**
 * Interactive: card tilts in 3D toward the cursor and shows a spotlight glow
 * that tracks the pointer. Pass the card's own styling via `className`.
 */
export function TiltCard({
  children,
  className = '',
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.transform = `perspective(900px) rotateX(${((0.5 - py) * max).toFixed(2)}deg) rotateY(${(
      (px - 0.5) *
      max
    ).toFixed(2)}deg) translateY(-4px)`;
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };

  const reset = () => {
    const el = ref.current;
    if (el) el.style.transform = '';
  };

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={reset} className={`tilt-card ${className}`}>
      <span className="tilt-glow" />
      <div className="relative">{children}</div>
    </div>
  );
}
