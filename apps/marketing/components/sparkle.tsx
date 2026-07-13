/** Accent: a small twinkling four-point star. */
export function Sparkle({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={`animate-twinkle ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <path d="M12 0c.6 6 5.4 10.8 12 12-6.6 1.2-11.4 6-12 12-.6-6-5.4-10.8-12-12C6.6 10.8 11.4 6 12 0Z" />
    </svg>
  );
}
