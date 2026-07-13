/** Hero animation: an animated scroll-down indicator. */
export function ScrollCue() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 sm:block">
      <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-ink/20 p-1.5">
        <span className="animate-cue h-1.5 w-1.5 rounded-full bg-ink/50" />
      </div>
    </div>
  );
}
