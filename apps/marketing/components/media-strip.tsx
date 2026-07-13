'use client';

import { useEffect, useState } from 'react';
import { Play, ImageIcon } from 'lucide-react';

const VIDEO_SRC = '/media/demo.mp4';
const VIDEO_POSTER = '/media/demo-poster.jpg';
const PHOTO_SRC = '/media/team.jpg';

/** Demo-video card — probes the file, shows a clean placeholder until it exists. */
export function MediaVideo() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(VIDEO_SRC, { method: 'HEAD' })
      .then((r) => alive && r.ok && setOk(true))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="group relative aspect-video h-full overflow-hidden rounded-3xl border border-line shadow-card">
      {ok ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className="h-full w-full object-cover" autoPlay muted loop playsInline poster={VIDEO_POSTER}>
          <source src={VIDEO_SRC} />
        </video>
      ) : (
        <div className="relative grid h-full place-items-center overflow-hidden bg-[radial-gradient(circle_at_30%_30%,#2b2f66,#0f1224)] text-center">
          <div className="bg-glow-brand animate-drift pointer-events-none absolute inset-0 opacity-40 blur-2xl" />
          <div className="relative">
            <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition group-hover:scale-110">
              <Play size={26} className="translate-x-0.5 fill-white" />
            </span>
            <p className="font-grotesk text-sm font-bold text-white">Watch the 90-second demo</p>
            <p className="mt-1 text-xs text-white/50">
              Add <code className="rounded bg-white/10 px-1">public{VIDEO_SRC}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lifestyle-photo card — probes the file, clean placeholder until it exists. */
export function MediaPhoto() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setOk(true);
    img.src = PHOTO_SRC;
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative aspect-video h-full overflow-hidden rounded-3xl border border-line shadow-card">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={PHOTO_SRC} alt="Agency team using Grapme" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#eef1fb,#dee3ff)] text-center">
          <div>
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-white text-brand shadow-soft">
              <ImageIcon size={24} />
            </span>
            <p className="font-grotesk text-sm font-bold text-ink">Team / lifestyle photo</p>
            <p className="mt-1 text-xs text-muted">
              Add <code className="rounded bg-line/60 px-1">public{PHOTO_SRC}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
