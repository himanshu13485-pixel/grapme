import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkHtml from 'remark-html';

const POSTS_DIR = path.join(process.cwd(), 'content', 'blog');

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ── DB-backed posts (authored in the app admin, served via the public API) ──
type ApiPostMeta = {
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  authorName: string | null;
  publishedAt: string | null;
  likes: number;
};
type ApiPost = ApiPostMeta & { contentHtml: string };

/** Normalised card the blog list + detail pages render, from either source. */
export type BlogCard = {
  slug: string;
  title: string;
  description: string;
  date: string;
  coverImage?: string;
  authorName?: string;
  likes?: number;
};
export type BlogArticle = BlogCard & { contentHtml: string };

const dateOnly = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

async function fetchApiPosts(): Promise<ApiPostMeta[] | null> {
  try {
    const res = await fetch(`${API_URL}/blog/public`, {
      next: { revalidate: 120, tags: ['public-posts'] },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ApiPostMeta[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function fetchApiPost(slug: string): Promise<ApiPost | null> {
  try {
    const res = await fetch(`${API_URL}/blog/public/${encodeURIComponent(slug)}`, {
      next: { revalidate: 120, tags: ['public-posts'] },
    });
    if (!res.ok) return null;
    return (await res.json()) as ApiPost;
  } catch {
    return null;
  }
}

/**
 * Blog cards for the list page — DB posts when any exist, else the bundled
 * markdown posts (so the page is never empty before the CMS is used).
 */
export async function getBlogCards(): Promise<BlogCard[]> {
  const api = await fetchApiPosts();
  if (api && api.length > 0) {
    return api.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.excerpt ?? '',
      date: dateOnly(p.publishedAt),
      coverImage: p.coverImage ?? undefined,
      authorName: p.authorName ?? undefined,
      likes: p.likes,
    }));
  }
  return getAllPosts().map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    date: p.date,
  }));
}

/** A single article — DB post first, falling back to a markdown post. */
export async function getBlogArticle(slug: string): Promise<BlogArticle | null> {
  const api = await fetchApiPost(slug);
  if (api) {
    return {
      slug: api.slug,
      title: api.title,
      description: api.excerpt ?? '',
      date: dateOnly(api.publishedAt),
      coverImage: api.coverImage ?? undefined,
      authorName: api.authorName ?? undefined,
      likes: api.likes,
      contentHtml: api.contentHtml,
    };
  }
  const md = await getPostBySlug(slug);
  if (!md) return null;
  return { slug: md.slug, title: md.title, description: md.description, date: md.date, contentHtml: md.contentHtml };
}

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
};

export type Post = PostMeta & { contentHtml: string };

export function getAllPosts(): PostMeta[] {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));

  return files
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
      const { data } = matter(raw);
      return {
        slug,
        title: data.title as string,
        description: data.description as string,
        date: data.date as string,
        tags: (data.tags as string[]) ?? [],
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const filePath = path.join(POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  const processed = await remark().use(remarkHtml).process(content);

  return {
    slug,
    title: data.title as string,
    description: data.description as string,
    date: data.date as string,
    tags: (data.tags as string[]) ?? [],
    contentHtml: processed.toString(),
  };
}
