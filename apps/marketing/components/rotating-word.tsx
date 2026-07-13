'use client';

import { useEffect, useState } from 'react';

/** Kinetic typography: cycles through words with a slide-up animation. */
export function RotatingWord({
  words,
  interval = 2200,
  className = '',
}: {
  words: string[];
  interval?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  return (
    <span className="rotating-word">
      <span key={i} className={`rotating-word__item ${className}`}>
        {words[i]}
      </span>
    </span>
  );
}
