/**
 * Hero "video" background.
 *  - If `src` is given, plays a real looping muted video (drop an .mp4/.webm in
 *    /public and pass its path, e.g. <VideoBackground src="/hero.mp4" poster="/hero.jpg" />).
 *  - Otherwise falls back to an animated aurora (moving gradient) — motion without
 *    the weight of a video file. Reduced-motion users get a still gradient.
 */
export function VideoBackground({ src, poster }: { src?: string; poster?: string }) {
  if (src) {
    return (
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <video className="h-full w-full object-cover opacity-70" autoPlay muted loop playsInline poster={poster}>
          <source src={src} />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-paper/30 via-paper/40 to-[#f4f6fd]" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(#000,transparent_92%)]" aria-hidden>
      <div className="aurora-blob animate-aurora-a bg-glow-brand absolute -left-[10%] -top-[20%] h-[70vh] w-[70vh] rounded-full opacity-90 blur-[80px]" />
      <div className="aurora-blob animate-aurora-b bg-glow-teal absolute right-[-8%] top-[6%] h-[60vh] w-[60vh] rounded-full opacity-80 blur-[80px]" />
      <div className="aurora-blob animate-aurora-c bg-glow-amber absolute bottom-[-24%] left-[28%] h-[56vh] w-[56vh] rounded-full opacity-70 blur-[80px]" />
      <div className="noise absolute inset-0" />
    </div>
  );
}
