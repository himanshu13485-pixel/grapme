/** A pulsing "live" indicator: a dot that scales + emits an expanding ring,
 *  next to a softly blinking label. Signals real-time / active status. */
export function LiveDot({ label = 'Live', className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="animate-live-ping inline-block h-2.5 w-2.5 rounded-full bg-teal" />
      {label && (
        <span className="animate-blink-soft text-[11px] font-bold uppercase tracking-wide text-teal">{label}</span>
      )}
    </span>
  );
}
