import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export interface BlogInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  coverImage?: string | null;
  authorName?: string | null;
  status?: string; // "draft" | "published"
  publishedAt?: string | null;
}

@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
  }

  /** Ping the marketing site to refresh the blog after a change (fire-and-forget). */
  private notifyMarketing() {
    const url = process.env.MARKETING_REVALIDATE_URL;
    if (!url) return;
    const secret = process.env.REVALIDATE_SECRET;
    void fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-revalidate-secret': secret } : {}),
      },
      body: JSON.stringify({ tag: 'public-posts' }),
    }).catch(() => {});
  }

  private slugify(s: string): string {
    return (s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  /** Unique slug within the tenant (append -2, -3… on collision). */
  private async uniqueSlug(tenantId: string, base: string, excludeId?: string) {
    let slug = this.slugify(base) || 'post';
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.prisma.blogPost.findFirst({
        where: { tenantId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${this.slugify(base) || 'post'}-${n}`;
    }
  }

  /** Minimal HTML sanitizer — drop scripts/iframes/handlers/js: URLs, keep images. */
  private sanitize(html: string): string {
    return (html ?? '')
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?\s*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1=$2#$2')
      .slice(0, 200_000);
  }

  // ── Admin ──────────────────────────────────────────────────────────
  async listAdmin(user: AuthUser) {
    this.assertAdmin(user);
    return this.prisma.blogPost.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getAdmin(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const post = await this.prisma.blogPost.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async create(user: AuthUser, dto: BlogInput) {
    this.assertAdmin(user);
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('Title is required.');
    const status = dto.status === 'published' ? 'published' : 'draft';
    const slug = await this.uniqueSlug(user.tenantId, dto.slug || title);
    const post = await this.prisma.blogPost.create({
      data: {
        tenantId: user.tenantId,
        title,
        slug,
        excerpt: dto.excerpt?.trim() || null,
        contentHtml: this.sanitize(dto.contentHtml ?? ''),
        coverImage: dto.coverImage?.trim() || null,
        authorName: dto.authorName?.trim() || user.email || null,
        status,
        publishedAt: status === 'published' ? this.resolveDate(dto.publishedAt) : null,
      },
    });
    this.notifyMarketing();
    return post;
  }

  async update(user: AuthUser, id: string, dto: BlogInput) {
    this.assertAdmin(user);
    const existing = await this.prisma.blogPost.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Post not found');

    const nextStatus =
      dto.status === undefined ? existing.status : dto.status === 'published' ? 'published' : 'draft';
    // Set publishedAt the first time it goes live; keep it once set (unless overridden).
    let publishedAt = existing.publishedAt;
    if (nextStatus === 'published') {
      publishedAt = this.resolveDate(dto.publishedAt) ?? existing.publishedAt ?? new Date();
    } else {
      publishedAt = null;
    }

    const post = await this.prisma.blogPost.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.slug !== undefined ? { slug: await this.uniqueSlug(user.tenantId, dto.slug || dto.title || existing.title, id) } : {}),
        ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt?.trim() || null } : {}),
        ...(dto.contentHtml !== undefined ? { contentHtml: this.sanitize(dto.contentHtml) } : {}),
        ...(dto.coverImage !== undefined ? { coverImage: dto.coverImage?.trim() || null } : {}),
        ...(dto.authorName !== undefined ? { authorName: dto.authorName?.trim() || null } : {}),
        status: nextStatus,
        publishedAt,
      },
    });
    this.notifyMarketing();
    return post;
  }

  async remove(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const existing = await this.prisma.blogPost.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Post not found');
    await this.prisma.blogPost.delete({ where: { id } });
    this.notifyMarketing();
    return { ok: true };
  }

  private resolveDate(v?: string | null): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  // ── Public (marketing site) ────────────────────────────────────────
  /** Published posts for the primary tenant, newest first. */
  async publicList() {
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant) return [];
    const posts = await this.prisma.blogPost.findMany({
      where: { tenantId: tenant.id, status: 'published' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        slug: true, title: true, excerpt: true, coverImage: true,
        authorName: true, publishedAt: true, likes: true,
      },
    });
    return posts;
  }

  async publicBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Post not found');
    const post = await this.prisma.blogPost.findFirst({
      where: { tenantId: tenant.id, slug, status: 'published' },
      select: {
        slug: true, title: true, excerpt: true, contentHtml: true, coverImage: true,
        authorName: true, publishedAt: true, likes: true,
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  /** Public "like" — increments the counter, returns the new total. */
  async like(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Post not found');
    const post = await this.prisma.blogPost.findFirst({
      where: { tenantId: tenant.id, slug, status: 'published' },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    const updated = await this.prisma.blogPost.update({
      where: { id: post.id },
      data: { likes: { increment: 1 } },
      select: { likes: true },
    });
    return { likes: updated.likes };
  }
}
