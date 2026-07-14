'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { resizeAndUpload } from '@/lib/upload';
import { RichText } from '@/components/RichText';
import { PageHeader, EmptyState, Modal, Tabs, Pagination } from '@/components/ui';

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.grapme.com';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  contentHtml: string;
  coverImage?: string | null;
  authorName?: string | null;
  status: string;
  publishedAt?: string | null;
  likes: number;
  updatedAt: string;
}

export default function BlogAdminPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<BlogPost | 'new' | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(() => {
    api.get<BlogPost[]>('/blog').then(setPosts).catch((e) => setError(e.message)).finally(() => setLoaded(true));
  }, []);
  useEffect(load, [load]);

  const counts = useMemo(() => ({
    all: posts.length,
    published: posts.filter((p) => p.status === 'published').length,
    draft: posts.filter((p) => p.status !== 'published').length,
  }), [posts]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return posts
      .filter((p) => statusFilter === 'all' || (statusFilter === 'published' ? p.status === 'published' : p.status !== 'published'))
      .filter((p) => !s || [p.title, p.authorName, p.slug, p.excerpt].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [posts, q, statusFilter]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 whenever the filters change.
  useEffect(() => setPage(1), [q, statusFilter]);

  async function remove(p: BlogPost) {
    if (!confirm(`Delete post “${p.title}”? This removes it from the marketing site too.`)) return;
    try {
      await api.del(`/blog/${p.id}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  return (
    <div>
      <PageHeader
        title="Blog"
        subtitle="Write posts here — published ones appear automatically on the marketing site (grapme.com/blog)."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>+ New post</button>}
      />

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {loaded && posts.length === 0 ? (
        <EmptyState message="No posts yet. Write your first one to publish it on the marketing blog." />
      ) : (
        <>
          <Tabs
            tabs={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'published', label: 'Published', count: counts.published },
              { key: 'draft', label: 'Drafts', count: counts.draft },
            ]}
            active={statusFilter}
            onChange={(k) => setStatusFilter(k as 'all' | 'published' | 'draft')}
          />
          <div className="mb-4 flex items-center gap-3">
            <input
              className="input max-w-xs"
              placeholder="Search title / author / slug…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="ml-auto text-sm text-slate-400">{filtered.length} of {posts.length}</span>
          </div>

          <div className="card divide-y divide-slate-100">
            {paged.map((p) => (
            <div key={p.id} className="flex items-center gap-4 px-4 py-3">
              {p.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.coverImage} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="grid h-12 w-16 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-300">▦</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-800">{p.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${p.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                  {p.publishedAt && <span>{new Date(p.publishedAt).toLocaleDateString()}</span>}
                  {p.authorName && <span>· {p.authorName}</span>}
                  <span>· ♥ {p.likes}</span>
                  <span className="text-slate-300">/{p.slug}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                {p.status === 'published' && (
                  <a href={`${MARKETING_URL}/blog/${p.slug}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">View</a>
                )}
                <button className="text-brand-600 hover:underline" onClick={() => setEditing(p)}>Edit</button>
                <button className="text-rose-600 hover:underline" onClick={() => remove(p)}>Delete</button>
              </div>
            </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-400">No posts match your search.</div>
            )}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </>
      )}

      {editing && (
        <PostEditor
          post={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/** Local <input type="datetime-local"> value from an ISO string. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostEditor({ post, onClose, onSaved }: { post: BlogPost | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [contentHtml, setContentHtml] = useState(post?.contentHtml ?? '');
  const [coverImage, setCoverImage] = useState(post?.coverImage ?? '');
  const [authorName, setAuthorName] = useState(post?.authorName ?? '');
  const [status, setStatus] = useState(post?.status ?? 'draft');
  const [publishedAt, setPublishedAt] = useState(toLocalInput(post?.publishedAt));
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [error, setError] = useState('');
  const coverRef = useRef<HTMLInputElement>(null);

  async function uploadCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setError('');
    try {
      setCoverImage(await resizeAndUpload(file, 1920, 0.85));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed');
    } finally {
      setCoverBusy(false);
    }
  }

  async function save(nextStatus?: string) {
    if (!title.trim()) { setError('Title is required.'); return; }
    setBusy(true);
    setError('');
    const body = {
      title: title.trim(),
      excerpt: excerpt.trim() || null,
      contentHtml,
      coverImage: coverImage || null,
      authorName: authorName.trim() || null,
      status: nextStatus ?? status,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    };
    try {
      if (post) await api.patch(`/blog/${post.id}`, body);
      else await api.post('/blog', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={post ? 'Edit post' : 'New post'} wide disableBackdropClose>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The SPF/DKIM/DMARC check that runs before your campaign" />
        </div>

        <div>
          <label className="label">Cover image</label>
          <div className="flex items-center gap-3">
            {coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverImage} alt="" className="h-20 w-32 rounded-lg object-cover" />
            ) : (
              <div className="grid h-20 w-32 place-items-center rounded-lg bg-slate-100 text-slate-300">No image</div>
            )}
            <div className="flex flex-col gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={() => coverRef.current?.click()} disabled={coverBusy}>
                {coverBusy ? 'Uploading…' : coverImage ? 'Replace image' : 'Upload image'}
              </button>
              {coverImage && <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setCoverImage('')}>Remove</button>}
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={uploadCover} />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Excerpt <span className="font-normal text-slate-400">— short summary for the card & preview</span></label>
          <textarea className="input h-16" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Why deliverability checks belong inside the approval step…" />
        </div>

        <div>
          <label className="label">Content</label>
          <RichText
            value={contentHtml}
            onChange={setContentHtml}
            minHeight={260}
            placeholder="Write the post… use 🖼 to insert images."
            onImageUpload={(file) => resizeAndUpload(file, 1600, 0.85)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Author / publisher</label>
            <input className="input" value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="e.g. Grapme Team" />
          </div>
          <div>
            <label className="label">Publish date & time</label>
            <input type="datetime-local" className="input" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-slate-400">Defaults to now when you publish.</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={status === 'published'} onChange={(e) => setStatus(e.target.checked ? 'published' : 'draft')} />
            Published (live on the marketing site)
          </label>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            {status !== 'published' && (
              <button className="btn-ghost" onClick={() => save('draft')} disabled={busy}>Save draft</button>
            )}
            <button className="btn-primary" onClick={() => save()} disabled={busy}>
              {busy ? 'Saving…' : status === 'published' ? 'Publish' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
