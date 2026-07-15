import Link from 'next/link';
import type { Metadata } from 'next';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';
import { getBlogCards } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes on running your own outreach, team roles, and deliverability for growing businesses.',
};

export default async function BlogIndexPage() {
  const posts = await getBlogCards();

  return (
    <section className="relative overflow-hidden py-20">
      <FloatingDecor variant="a" />
      <Container className="relative z-10">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <h1 className="mb-3 font-display text-[clamp(2.4rem,6vw,4rem)] font-bold tracking-tightest text-ink">Field <span className="text-brand-gradient">notes.</span></h1>
          <p className="text-muted">How campaigns, team roles, and deliverability checks work in practice.</p>
        </Reveal>

        <div className="mx-auto grid max-w-4xl gap-6">
          {posts.map((post, i) => (
            <Reveal key={post.slug} delay={i * 80}>
              <TiltCard max={5}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block overflow-hidden rounded-2xl border border-line bg-paper/85 shadow-soft backdrop-blur-sm transition hover:border-brand/40 hover:shadow-card"
                >
                  {post.coverImage && (
                    <div className="aspect-[16/7] w-full overflow-hidden bg-mist">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.coverImage} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="p-7">
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-faint">
                      {post.date}{post.authorName ? ` · ${post.authorName}` : ''}
                    </p>
                    <h2 className="mb-2 font-display text-2xl font-bold leading-tight text-ink">{post.title}</h2>
                    {post.description && <p className="text-sm text-muted">{post.description}</p>}
                  </div>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
          {posts.length === 0 && (
            <p className="text-center text-muted">No posts yet — check back soon.</p>
          )}
        </div>
      </Container>
    </section>
  );
}
