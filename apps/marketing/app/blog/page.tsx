import Link from 'next/link';
import type { Metadata } from 'next';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { TiltCard } from '@/components/tilt-card';
import { FloatingDecor } from '@/components/floating-decor';
import { getAllPosts } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes on approval workflows, sub-admin delegation, and deliverability for agencies running outreach at scale.',
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <section className="relative overflow-hidden py-20">
      <FloatingDecor variant="a" />
      <Container className="relative z-10">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <h1 className="mb-3 font-display text-[clamp(2.4rem,6vw,4rem)] font-bold tracking-tightest text-ink">Field <span className="text-brand-gradient">notes.</span></h1>
          <p className="text-muted">How the approval workflow, roles, and deliverability checks work in practice.</p>
        </Reveal>

        <div className="mx-auto grid max-w-4xl gap-6">
          {posts.map((post, i) => (
            <Reveal key={post.slug} delay={i * 80}>
              <TiltCard max={5}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block rounded-2xl border border-line bg-paper/85 p-7 shadow-soft backdrop-blur-sm transition hover:border-brand/40 hover:shadow-card"
                >
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-faint">{post.date}</p>
                  <h2 className="mb-2 font-display text-2xl font-bold leading-tight text-ink">{post.title}</h2>
                  <p className="text-sm text-muted">{post.description}</p>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
