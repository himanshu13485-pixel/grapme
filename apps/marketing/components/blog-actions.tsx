'use client';

import { useState } from 'react';
import { Heart, Share2, Link2, Check } from 'lucide-react';

/** Like + share-via-URL controls for a blog post. */
export function BlogActions({ slug, title, initialLikes }: { slug: string; title: string; initialLikes: number }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function like() {
    if (liked || busy) return;
    setBusy(true);
    // Optimistic bump; reconcile with the server's count.
    setLikes((n) => n + 1);
    setLiked(true);
    try {
      const res = await fetch(`/api/blog/${encodeURIComponent(slug)}/like`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { likes?: number };
        if (typeof data.likes === 'number') setLikes(data.likes);
      }
    } catch {
      /* keep the optimistic value */
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={like}
        disabled={liked}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
          liked ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-line bg-paper/70 text-ink hover:border-rose-300 hover:text-rose-600'
        }`}
      >
        <Heart size={16} className={liked ? 'fill-current' : ''} /> {likes}
      </button>
      <button
        onClick={share}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-paper/70 px-4 py-2 text-sm font-bold text-ink transition hover:border-brand/40 hover:text-brand"
      >
        {copied ? <><Check size={16} /> Link copied</> : <><Share2 size={16} /> Share</>}
      </button>
      <ShareLinks title={title} />
    </div>
  );
}

function ShareLinks({ title }: { title: string }) {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const enc = encodeURIComponent;
  const links = [
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(title + ' ' + url)}` },
  ];
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Link2 size={14} />
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="rounded-full px-2 py-1 font-semibold hover:text-brand hover:underline">
          {l.label}
        </a>
      ))}
    </div>
  );
}
