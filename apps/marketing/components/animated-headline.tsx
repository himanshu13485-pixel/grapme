'use client';

/**
 * Hero headline with a staggered word-by-word rise (fade + slide + de-blur).
 * `lead` renders in the base ink colour; `accent` renders in the animated
 * gradient italic. Each word animates in sequence.
 */
export function AnimatedHeadline({
  lead,
  accent,
  className = '',
}: {
  lead: string;
  accent?: string;
  className?: string;
}) {
  const leadWords = lead.split(' ');
  const accentWords = accent ? accent.split(' ') : [];
  let idx = 0;

  return (
    <h1 className={className}>
      {leadWords.map((w) => {
        const delay = idx++ * 55;
        return (
          <span key={`l-${idx}`} className="word-rise" style={{ animationDelay: `${delay}ms` }}>
            {w}&nbsp;
          </span>
        );
      })}
      {accentWords.map((w) => {
        const delay = idx++ * 55;
        return (
          <span
            key={`a-${idx}`}
            className="word-rise text-brand-gradient italic"
            style={{ animationDelay: `${delay}ms` }}
          >
            {w}&nbsp;
          </span>
        );
      })}
    </h1>
  );
}
