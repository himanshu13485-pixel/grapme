'use client';

import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { DemoMockup } from './demo-mockup';

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
        // animated code mockup stands in until public/media/demo.mp4 exists
        <DemoMockup />
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
    <div className="relative h-full min-h-[240px] overflow-hidden rounded-3xl border border-line shadow-card">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={PHOTO_SRC} alt="Team using GrapMe" className="h-full w-full object-cover" />
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
