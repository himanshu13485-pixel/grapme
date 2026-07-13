import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { FloatingDecor } from '@/components/floating-decor';
import { getAllPosts, getPostBySlug } from '@/lib/posts';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    openGraph: { title: post.title, description: post.description, type: 'article' },
  };
}

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <article className="relative overflow-hidden py-20">
      <FloatingDecor variant="c" />
      <Container className="relative z-10 max-w-3xl">
        <Reveal>
          <Link href="/blog" className="mb-8 inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline">
            <ArrowLeft size={16} /> Back to blog
          </Link>

          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-faint">{post.date}</p>
          <h1 className="mb-8 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-bold leading-[1.02] tracking-tightest text-ink">{post.title}</h1>
        </Reveal>

        <Reveal delay={120} className="prose-blog" >
          <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
        </Reveal>
      </Container>
    </article>
  );
}
