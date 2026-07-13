'use client';

import { useEffect, useState } from 'react';

/**
 * Personalized content — computed entirely client-side (no network, no tracking):
 *  - time-of-day greeting from the visitor's own clock
 *  - a tailored note if they arrived from LinkedIn (utm_source / ref / referrer)
 *  - a "welcome back" for return visitors (localStorage flag)
 * Renders nothing on the server / first paint to avoid hydration mismatch,
 * then fills in after mount.
 */
export function PersonalGreeting() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const h = new Date().getHours();
      const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

      const params = new URLSearchParams(window.location.search);
      const source = (params.get('utm_source') || params.get('ref') || document.referrer || '').toLowerCase();
      const returning = localStorage.getItem('grapme_seen');
      localStorage.setItem('grapme_seen', '1');

      let tail = '';
      if (source.includes('linkedin')) tail = ' — glad you came over from LinkedIn';
      else if (returning) tail = ' — welcome back';

      setMsg(`${part}${tail}`);
    } catch {
      /* private-mode / SSR guard — just skip personalization */
    }
  }, []);

  if (!msg) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
      {msg}
    </span>
  );
}
