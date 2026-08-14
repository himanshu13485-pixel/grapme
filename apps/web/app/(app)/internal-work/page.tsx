'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth, useCanDelete } from '@/lib/auth';
import { RichText } from '@/components/RichText';
import { SeenBy, type Seen } from '@/components/SeenBy';
import { PageHeader } from '@/components/ui';

type Audience = 'ALL_STAFF' | 'ALL_STAFF_SALES' | 'USER';
const roleLabel = (r: string) => r === 'SUPER_ADMIN' ? 'Admin' : r === 'SUB_ADMIN' ? 'Sub Admin' : r === 'SALES' ? 'Salesperson' : 'Staff';

interface NoteRow {
  id: string;
  title: string;
  status: 'DRAFT' | 'POSTED';
  clientId: string | null;
  clientName: string | null;
  audienceLabel: string | null;
  showInApp: boolean;
  sendEmail: boolean;
  recipientCount: number;
  createdByUserId: string;
  createdByName: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface NoteMessage { id: string; userId: string; authorName: string | null; body: string; createdAt: string; seenBy?: Seen[] }
interface NoteFull extends NoteRow {
  bodyHtml: string;
  audience: Audience;
  targetUserId: string | null;
  messages?: NoteMessage[];
  seenBy?: Seen[];
}
interface Staff { id: string; name: string; email: string; role: string }

export default function InternalWorkPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Loading…</div>}>
      <InternalWorkInner />
    </Suspense>
  );
}

function InternalWorkInner() {
  const params = useSearchParams();
  const { user } = useAuth();
  const isSales = user?.role === 'SALES';
  const canDelete = useCanDelete();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [viewing, setViewing] = useState<NoteFull | null>(null);
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  // composer
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [audience, setAudience] = useState<Audience>('ALL_STAFF');
  const [targetUserId, setTargetUserId] = useState('');
  const [showInApp, setShowInApp] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [bodyHtml, setBodyHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [filterClient, setFilterClient] = useState('');

  const load = useCallback(() => {
    const qs = filterClient ? `?clientId=${filterClient}` : '';
    api.get<NoteRow[]>(`/internal-work${qs}`).then(setNotes).catch(() => {});
  }, [filterClient]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<Staff[]>('/internal-work/staff').then(setStaff).catch(() => {});
    // Salespersons only pick from their own clients; admins from all.
    const clientsUrl = isSales ? '/sales/my/clients' : '/clients';
    api.get<{ id: string; name: string }[]>(clientsUrl).then((cs) => setClients(cs.map((c) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, [isSales]);

  // Deep link from the bell: /internal-work?note=<id>
  useEffect(() => {
    const id = params.get('note');
    if (id) view(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function view(id: string) {
    setReply('');
    try {
      setViewing(await api.get<NoteFull>(`/internal-work/${id}`));
      // Opening a note marks it read → refresh the nav unread badge.
      window.dispatchEvent(new Event('internal-work-changed'));
    } catch { /* ignore */ }
  }

  async function sendReply() {
    if (!viewing || !reply.trim()) return;
    setReplyBusy(true);
    try {
      await api.post(`/internal-work/${viewing.id}/messages`, { body: reply.trim() });
      setReply('');
      setViewing(await api.get<NoteFull>(`/internal-work/${viewing.id}`));
      load();
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setReplyBusy(false); }
  }

  function resetForm() {
    setEditingId(null); setTitle(''); setClientId(''); setAudience('ALL_STAFF');
    setTargetUserId(''); setShowInApp(true); setSendEmail(false); setBodyHtml('');
    setEditorKey((k) => k + 1); setMsg(''); setErr('');
  }

  function payload() {
    return { title, bodyHtml, clientId: clientId || undefined, audience, targetUserId: targetUserId || undefined, showInApp, sendEmail };
  }

  async function loadDraft(id: string) {
    setErr(''); setMsg('');
    try {
      const n = await api.get<NoteFull>(`/internal-work/${id}`);
      setEditingId(n.id); setTitle(n.title); setClientId(n.clientId ?? '');
      setAudience(n.audience); setTargetUserId(n.targetUserId ?? '');
      setShowInApp(n.showInApp); setSendEmail(n.sendEmail); setBodyHtml(n.bodyHtml);
      setEditorKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load draft'); }
  }

  async function saveDraft() {
    setErr(''); setMsg('');
    if (!title.trim()) return setErr('Add a title to save a draft.');
    setBusy(true);
    try {
      if (editingId) await api.patch(`/internal-work/drafts/${editingId}`, payload());
      else { const { id } = await api.post<{ id: string }>('/internal-work/drafts', payload()); setEditingId(id); }
      setMsg('Draft saved.'); load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to save'); }
    finally { setBusy(false); }
  }

  async function post() {
    setErr(''); setMsg('');
    if (!title.trim()) return setErr('Add a title.');
    if (!bodyHtml.replace(/<[^>]+>/g, '').trim()) return setErr('Add some detail in the body.');
    if (audience === 'USER' && !targetUserId) return setErr('Choose who to share it with.');
    setBusy(true);
    try {
      let r: { recipientCount: number };
      if (editingId) {
        await api.patch(`/internal-work/drafts/${editingId}`, payload());
        r = await api.post<{ recipientCount: number }>(`/internal-work/drafts/${editingId}/post`);
      } else {
        r = await api.post<{ recipientCount: number }>('/internal-work', payload());
      }
      setMsg(`Posted — shared with ${r.recipientCount} colleague${r.recipientCount === 1 ? '' : 's'}.`);
      resetForm(); load();
      window.dispatchEvent(new Event('internal-work-changed'));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to post'); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    await api.del(`/internal-work/${id}`);
    if (editingId === id) resetForm();
    load();
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Internal Work"
        subtitle="Private notes & discussion for the team — client hand-offs, context and decisions. Clients never see this."
      />

      <div className="card mb-8 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{editingId ? 'Edit draft' : 'New note'}</h2>
          {editingId && <button onClick={resetForm} className="text-sm font-medium text-slate-500 hover:text-slate-700">Start new</button>}
        </div>
        {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

        <div className="space-y-4">
          <div>
            <label className="label">Title *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme — renewal discussion + data handover" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">About client (optional)</label>
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— General (no client) —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Share with *</label>
              <select
                className="input"
                value={audience === 'USER' ? `USER:${targetUserId}` : audience}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'ALL_STAFF' || v === 'ALL_STAFF_SALES') { setAudience(v); setTargetUserId(''); }
                  else { setAudience('USER'); setTargetUserId(v.slice(5)); }
                }}
              >
                <option value="ALL_STAFF">All admins &amp; sub-admins</option>
                <option value="ALL_STAFF_SALES">All admins, sub-admins &amp; salespersons</option>
                {staff.map((s) => (
                  <option key={s.id} value={`USER:${s.id}`}>{s.name || s.email} · {roleLabel(s.role)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={showInApp} onChange={(e) => setShowInApp(e.target.checked)} />
              Show in-app (notification bell)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Send email
            </label>
          </div>

          <div>
            <label className="label">Details *</label>
            <RichText key={`body-${editorKey}`} value={bodyHtml} onChange={setBodyHtml} placeholder="Client data, decisions, next steps… (bold, lists, links supported)" />
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" disabled={busy} onClick={saveDraft}>{busy ? '…' : editingId ? 'Update draft' : 'Save draft'}</button>
            <button className="btn-primary" disabled={busy} onClick={post}>{busy ? 'Posting…' : 'Post to team'}</button>
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Board</h2>
        <select className="input w-56" value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Shared with</th>
              <th className="px-4 py-3">By</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {notes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nothing here yet.</td></tr>
            ) : notes.map((n) => (
              <tr key={n.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button onClick={() => view(n.id)} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {n.title || <span className="text-slate-400">(untitled)</span>}
                  </button>
                  {n.status === 'DRAFT' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Draft</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{n.clientName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{n.audienceLabel ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{n.createdByName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(n.updatedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-3 text-sm font-medium">
                    <button onClick={() => view(n.id)} className="text-brand-700 hover:underline">View</button>
                    {n.status === 'DRAFT' && <button onClick={() => loadDraft(n.id)} className="text-slate-600 hover:underline">Edit</button>}
                    {canDelete && !isSales && <button onClick={() => del(n.id)} className="text-rose-600 hover:underline">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={() => setViewing(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold text-slate-800">{viewing.title}</h2>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              {viewing.clientName && <span>Client: <strong className="text-slate-700">{viewing.clientName}</strong></span>}
              <span>Shared with: <strong className="text-slate-700">{viewing.audienceLabel ?? '—'}</strong></span>
              <span>By: <strong className="text-slate-700">{viewing.createdByName ?? '—'}</strong></span>
              <span>{new Date(viewing.postedAt ?? viewing.createdAt).toLocaleString()}</span>
            </div>
            {/* Opening post */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <div className="mb-1 text-xs text-slate-500"><strong className="text-slate-700">{viewing.createdByName ?? 'Author'}</strong> · {new Date(viewing.postedAt ?? viewing.createdAt).toLocaleString()}</div>
              <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: viewing.bodyHtml }} />
              <SeenBy seen={viewing.seenBy} />
            </div>

            {/* Discussion thread */}
            {viewing.status === 'POSTED' && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Discussion</div>
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {(viewing.messages ?? []).length === 0 && <div className="text-xs text-slate-400">No messages yet — start the conversation.</div>}
                  {(viewing.messages ?? []).map((m) => {
                    const mine = m.userId === user?.id;
                    return (
                      <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                          {!mine && <div className="mb-0.5 text-[11px] font-semibold text-slate-500">{m.authorName ?? 'Someone'}</div>}
                          <div className="whitespace-pre-wrap">{m.body}</div>
                          <div className={`mt-0.5 text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{new Date(m.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="max-w-[80%]"><SeenBy seen={m.seenBy} align={mine ? 'right' : 'left'} /></div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-end gap-2 border-t border-slate-100 pt-3">
                  <textarea
                    className="input flex-1" rows={2} value={reply} disabled={replyBusy}
                    placeholder="Write a message…"
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
                  />
                  <button className="btn-primary" disabled={replyBusy || !reply.trim()} onClick={sendReply}>{replyBusy ? '…' : 'Send'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
