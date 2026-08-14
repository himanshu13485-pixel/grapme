'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, Tabs, Pagination, EmptyState, Modal } from '@/components/ui';
import { RichText } from '@/components/RichText';
import { SeenBy } from '@/components/SeenBy';
import {
  UpdateThread, UpdatesPage, UpdateType, UPDATE_TYPES,
  updateTypeMeta, authorRoleLabel, timeAgo, dateTime,
} from '@/lib/updates';

// Read a picked file as a data: URL for the JSON attachment payload.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Pull a private attachment (auth header) and save it under its original name.
async function downloadAttachment(path: string, name: string) {
  try {
    const blob = await fetchBlob(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch { alert('Could not download the attachment.'); }
}

const ATTACH_ACCEPT = '.pdf,image/*,.doc,.docx,.xls,.xlsx';
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

/** A clickable download chip for an attachment (thread or reply). */
function AttachmentChip({ path, name }: { path: string; name: string }) {
  return (
    <button
      type="button"
      onClick={() => downloadAttachment(path, name)}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-600"
      title={`Download ${name}`}
    >
      <span>📎</span><span className="truncate">{name}</span>
    </button>
  );
}

/** Human-readable file size (KB/MB) for the picked-file chip. */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File attachment picker with drag-and-drop OR click-to-browse. Shows the picked
 * file with size + a remove button. `compact` renders a slimmer strip for the reply box.
 */
function AttachmentPicker({
  file, onFile, compact,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (f?: File | null) => { if (f) onFile(f); };
  const clear = () => { onFile(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span>📎</span>
          <span className="min-w-0 flex-1 truncate text-slate-700">{file.name}</span>
          <span className="shrink-0 text-xs text-slate-400">{fmtSize(file.size)}</span>
          <button type="button" className="shrink-0 text-xs text-rose-500 hover:text-rose-700" onClick={clear}>Remove</button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0] ?? null); }}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-center transition ${
            compact ? 'px-3 py-2 text-xs' : 'px-3 py-4 text-sm'
          } ${dragging ? 'border-brand-400 bg-brand-50 text-brand-600' : 'border-slate-300 bg-slate-50/50 text-slate-500 hover:border-brand-300 hover:text-brand-600'}`}
        >
          <span>📎</span>
          <span>{dragging ? 'Drop the file to attach' : <>Drag a file here or <span className="font-medium underline">browse</span></>}</span>
        </div>
      )}
    </div>
  );
}

export default function UpdatesBoardPage() {
  const { user } = useAuth();
  const isAdmin = !!user && user.role !== 'CLIENT';
  const canDelete = user?.role === 'SUPER_ADMIN' || (user?.role === 'SUB_ADMIN' && (user.fullAccess || user.canDelete));

  const [type, setType] = useState<'' | UpdateType>('');
  const [clientId, setClientId] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UpdatesPage | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bumped = useRef(false);

  // Clients the current user can file/see updates under (composer + admin filter).
  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/updates/client-options').then(setClients).catch(() => {});
  }, []);

  // Deep link from the bell: /updates?thread=<id> opens that thread. We do NOT
  // clear the whole feed here — each thread clears its own bell rows when opened.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('thread');
    if (t) setOpenId(t);
  }, []);

  async function markAllRead() {
    await api.post('/updates/bell/seen', {}).catch(() => {});
    window.dispatchEvent(new Event('updates-changed'));
  }

  useEffect(() => {
    const h = setTimeout(() => { setDq(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page) });
    if (type) qs.set('type', type);
    if (clientId) qs.set('clientId', clientId);
    if (dq) qs.set('search', dq);
    api.get<UpdatesPage>(`/updates?${qs}`).then(setData).catch(() => {});
  }, [type, clientId, dq, page, reloadKey]);
  useEffect(() => { load(); }, [load]);

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Work"
        subtitle={isAdmin ? 'Post work updates to a client and keep the conversation (incl. meetings) in one place.' : 'Work updates from your account team — reply anytime.'}
        action={(
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={markAllRead}>✓ Mark all read</button>
            <button className="btn-primary" onClick={() => setComposing(true)}>＋ New work update</button>
          </div>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input w-full sm:w-64" placeholder="Search title, body, author…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isAdmin && clients.length > 0 && (
          <select className="input w-full sm:w-56" value={clientId} onChange={(e) => { setClientId(e.target.value); setPage(1); }}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* List */}
      {!data ? (
        <EmptyState message="Loading…" />
      ) : data.items.length === 0 ? (
        <EmptyState message={dq || type || clientId ? 'No updates match your filters.' : 'No updates yet. Create the first one.'} />
      ) : (
        <div className="space-y-2">
          {data.items.map((t) => {
            const meta = updateTypeMeta(t.type);
            const replies = t._count?.replies ?? 0;
            return (
              <button key={t.id} onClick={() => setOpenId(t.id)} className="card flex w-full items-center gap-3 p-4 text-left transition hover:shadow-md">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base ${meta.cls}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{t.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {isAdmin && (data.clientNames[t.clientId] ? <span className="font-medium text-slate-600">{data.clientNames[t.clientId]} · </span> : null)}
                    {t.authorName} ({authorRoleLabel(t.authorRole)}) · {timeAgo(t.lastActivityAt)}
                  </div>
                </div>
                {t.attachmentName && <span className="shrink-0 text-slate-400" title="Has an attachment">📎</span>}
                {replies > 0 && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">💬 {replies}</span>}
              </button>
            );
          })}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          <div className="pt-1 text-center text-xs text-slate-400">{data.total} update{data.total === 1 ? '' : 's'} total</div>
        </div>
      )}

      {composing && (
        <Composer
          isAdmin={isAdmin}
          clients={clients}
          onClose={() => setComposing(false)}
          onCreated={(id) => { setComposing(false); reload(); setOpenId(id); }}
        />
      )}
      {openId && (
        <ThreadDetail
          id={openId}
          canDelete={!!canDelete}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onDeleted={() => { setOpenId(null); reload(); }}
        />
      )}
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────
function Composer({
  isAdmin, clients, onClose, onCreated,
}: {
  isAdmin: boolean;
  clients: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [type, setType] = useState<UpdateType>('WORK');
  const [title, setTitle] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [clientId, setClientId] = useState(clients.length === 1 ? clients[0].id : '');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!clientId) return setError(isAdmin ? 'Select a client.' : 'No workspace available to post under.');
    if (!title.trim()) return setError('Add a title.');
    const text = bodyHtml.replace(/<[^>]+>/g, '').trim();
    if (!text) return setError('Add some detail in the body.');
    if (file && file.size > MAX_ATTACH_BYTES) return setError('File too large (max 5 MB).');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { clientId, type, title, bodyHtml, notifyEmail, notifyWhatsapp };
      if (file) {
        payload.attachmentBase64 = await fileToBase64(file);
        payload.attachmentName = file.name;
        payload.attachmentMime = file.type;
      }
      const t = await api.post<{ id: string }>('/updates', payload);
      onCreated(t.id);
    } catch (e: any) { setError(e.message ?? 'Could not save'); setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="New update" wide disableBackdropClose>
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="space-y-3">
        {isAdmin && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Client *</label>
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Title *</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary…" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Details</label>
          <RichText value={bodyHtml} onChange={setBodyHtml} placeholder="Write the update… (bold, lists, links supported)" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Attachment <span className="font-normal text-slate-400">(optional — PDF, image, Word, or Excel · max 5 MB)</span></label>
          <AttachmentPicker file={file} onFile={setFile} />
        </div>
        <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} /> ✉ Send Email</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} /> 💬 Send WhatsApp</label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Posting…' : 'Post update'}</button>
      </div>
    </Modal>
  );
}

// ── Thread detail ─────────────────────────────────────────────────────────
function ThreadDetail({
  id, canDelete, onClose, onChanged, onDeleted,
}: {
  id: string;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [t, setT] = useState<UpdateThread | null>(null);
  const [reply, setReply] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<UpdateThread>(`/updates/${id}`).then((th) => {
      setT(th);
      // Opening a thread clears its own bell notifications for this user.
      api.post(`/updates/${id}/seen`, {}).then(() => window.dispatchEvent(new Event('updates-changed'))).catch(() => {});
    }).catch(() => onClose());
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    if (file && file.size > MAX_ATTACH_BYTES) { setError('File too large (max 5 MB).'); return; }
    setBusy(true); setError('');
    try {
      const payload: Record<string, unknown> = { body: reply };
      if (file) {
        payload.attachmentBase64 = await fileToBase64(file);
        payload.attachmentName = file.name;
        payload.attachmentMime = file.type;
      }
      const updated = await api.post<UpdateThread>(`/updates/${id}/replies`, payload);
      setT(updated); setReply(''); setFile(null);
      onChanged();
    } catch (e: any) { setError(e.message ?? 'Could not send'); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm('Delete this update and all its replies? This cannot be undone.')) return;
    setBusy(true);
    try { await api.del(`/updates/${id}`); onDeleted(); }
    catch (e: any) { setError(e.message ?? 'Delete failed'); setBusy(false); }
  }

  const meta = t ? updateTypeMeta(t.type) : null;

  return (
    <Modal open onClose={onClose} title={t?.title ?? 'Update'} wide>
      {!t ? (
        <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={`rounded-full px-2 py-0.5 font-medium ${meta!.cls}`}>{meta!.icon} {meta!.label}</span>
            {t.clientName && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t.clientName}</span>}
            <span>·</span>
            <span title={dateTime(t.createdAt)}>{t.authorName} ({authorRoleLabel(t.authorRole)}) · {timeAgo(t.createdAt)}</span>
            {(t.notifyEmail || t.notifyWhatsapp) && (
              <span className="text-slate-400">· notifies {[t.notifyEmail && 'Email', t.notifyWhatsapp && 'WhatsApp'].filter(Boolean).join(' + ')}</span>
            )}
          </div>

          {/* Opening comment (rich text, sanitized server-side) */}
          <div
            className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-sm leading-relaxed text-slate-800 [&_a]:text-brand-600 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: t.bodyHtml }}
          />
          {t.attachmentName && <AttachmentChip path={`/updates/${t.id}/attachment`} name={t.attachmentName} />}
          <SeenBy seen={t.seenBy} />

          {/* Replies */}
          <div className="mt-4 space-y-3">
            {(t.replies ?? []).map((r) => (
              <div key={r.id} className="flex gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-white">
                  {(r.authorName || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{r.authorName}</span> ({authorRoleLabel(r.authorRole)}) · <span title={dateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-slate-800">{r.body}</div>
                  {r.attachmentName && <AttachmentChip path={`/updates/replies/${r.id}/attachment`} name={r.attachmentName} />}
                  <SeenBy seen={r.seenBy} />
                </div>
              </div>
            ))}
            {(t.replies ?? []).length === 0 && <div className="text-xs text-slate-400">No replies yet.</div>}
          </div>

          {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          {/* Add reply ("Add More") */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <label className="mb-1 block text-sm font-medium text-slate-600">Add a reply</label>
            <textarea className="input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
            <div className="mt-2">
              <AttachmentPicker file={file} onFile={setFile} compact />
            </div>
            <div className="mt-2 flex items-center justify-between">
              {canDelete ? <button className="text-sm text-rose-500 hover:text-rose-700" onClick={del} disabled={busy}>Delete update</button> : <span />}
              <button className="btn-primary" onClick={sendReply} disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Add reply'}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
