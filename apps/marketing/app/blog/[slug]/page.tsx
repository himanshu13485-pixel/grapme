import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { FloatingDecor } from '@/components/floating-decor';
import { BlogActions } from '@/components/blog-actions';
import { getBlogArticle } from '@/lib/posts';

// Posts are DB-backed (and may change any time), so render on demand.
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getBlogArticle(params.slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      images: post.coverImage ? [post.coverImage] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await getBlogArticle(params.slug);
  if (!post) notFound();

  return (
    <article className="relative overflow-hidden py-20">
      <FloatingDecor variant="c" />
      <Container className="relative z-10 max-w-3xl">
        <Reveal>
          <Link href="/blog" className="mb-8 inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline">
            <ArrowLeft size={16} /> Back to blog
          </Link>

          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-faint">
            {post.date}{post.authorName ? ` · ${post.authorName}` : ''}
          </p>
          <h1 className="mb-6 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-bold leading-[1.02] tracking-tightest text-ink">{post.title}</h1>
        </Reveal>

        {post.coverImage && (
          <Reveal delay={80}>
            <div className="mb-8 overflow-hidden rounded-2xl border border-line bg-mist">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.coverImage} alt="" className="max-h-[440px] w-full object-cover" />
            </div>
          </Reveal>
        )}

        <Reveal delay={120} className="prose-blog">
          <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
        </Reveal>

        <div className="mt-10 border-t border-line pt-6">
          <BlogActions slug={post.slug} title={post.title} initialLikes={post.likes ?? 0} />
        </div>
      </Container>
    </article>
  );
}
