'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, fetchBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// ─────────────────────────── shared types ───────────────────────────
interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  side: 'client' | 'support';
  authorName: string;
  attachment: { name: string; mime: string } | null;
}
interface Thread {
  id: string;
  subject: string;
  category: string | null;
  status: string;
  satisfaction: string | null;
  satisfactionNote: string | null;
  escalatedAt: string | null;
  escalationNote?: string | null;
  escalatedBy?: { id: string; name: string } | null;
  createdAt: string;
  lastReplyAt: string;
  client: { id: string; name: string; email?: string | null; mobile?: string | null } | null;
  raisedBy: { id: string; name: string; email: string } | null;
  handledBy: { id: string; name: string; role: string } | null;
  messages: ThreadMessage[];
}

const STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700',
  ANSWERED: 'bg-sky-50 text-sky-700',
  RESOLVED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

function signalChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('support-changed'));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function downloadAttachment(messageId: string, name: string) {
  try {
    const blob = await fetchBlob(`/support/attachments/${messageId}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    alert('Could not download the attachment.');
  }
}

// ─────────────────────────── page shell ───────────────────────────
export default function SupportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Loading…</div>}>
      <SupportInner />
    </Suspense>
  );
}

function SupportInner() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'CLIENT') return <ClientSupport />;
  return <StaffSupport />;
}

// ─────────────────────────── reply composer ───────────────────────────
function Composer({ onSend, disabled }: { onSend: (message: string, file: File | null) => Promise<void>; disabled?: boolean }) {
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!message.trim()) return;
    if (file && file.size > 5 * 1024 * 1024) { setErr('File too large (max 5 MB).'); return; }
    setBusy(true); setErr('');
    try {
      await onSend(message.trim(), file);
      setMessage(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to send');
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-slate-200 pt-3">
      {err && <div className="mb-2 text-sm text-rose-600">{err}</div>}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write a reply…"
        rows={3}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={disabled}
          className="text-xs text-slate-500"
        />
        <button
          onClick={submit}
          disabled={busy || disabled || !message.trim()}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function MessageList({ messages }: { messages: ThreadMessage[] }) {
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.side === 'support' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.side === 'support' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
            <div className="mb-0.5 text-[11px] font-medium opacity-70">
              {m.authorName} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
            {m.attachment && (
              <button
                onClick={() => downloadAttachment(m.id, m.attachment!.name)}
                className={`mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${m.side === 'support' ? 'bg-white/20' : 'bg-white'}`}
              >
                📎 {m.attachment.name}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════ CLIENT PORTAL ═══════════════════════════
interface Workspace { id: string; name: string; manager: { name: string; email: string; phone: string | null } | null }
interface ClientContext { workspaces: Workspace[]; generic: { email: string; phone: string } }
interface ClientTicket {
  id: string; subject: string; status: string; satisfaction: string | null;
  lastReplyAt: string; lastReplyRole: string; createdAt: string;
  client: { id: string; name: string } | null; assignedTo: { name: string } | null;
}

function ClientSupport() {
  const params = useSearchParams();
  const router = useRouter();
  const [ctx, setCtx] = useState<ClientContext | null>(null);
  const [tickets, setTickets] = useState<ClientTicket[]>([]);
  const [view, setView] = useState<'list' | 'new'>('list');
  const activeId = params.get('ticket');

  const loadTickets = useCallback(() => {
    api.get<ClientTicket[]>('/support/my/tickets').then(setTickets).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<ClientContext>('/support/my/context').then(setCtx).catch(() => {});
    loadTickets();
  }, [loadTickets]);

  if (activeId) {
    return <ClientThread id={activeId} onBack={() => { router.push('/support'); loadTickets(); }} />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Client Support</h1>
          <p className="text-sm text-slate-500">Raise a ticket and chat with your account team.</p>
        </div>
        {view === 'list' && (
          <button onClick={() => setView('new')} className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white">
            + New ticket
          </button>
        )}
      </div>

      {/* Support contact card */}
      {ctx && <ContactCard ctx={ctx} />}

      {view === 'new' ? (
        <NewTicketForm
          ctx={ctx}
          onCancel={() => setView('list')}
          onCreated={(id) => { setView('list'); loadTickets(); router.push(`/support?ticket=${id}`); }}
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {tickets.length === 0 ? (
            <div className="px-4 py-10 text-center text-slate-400">No tickets yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/support?ticket=${t.id}`)}>
                    <td className="px-4 py-3 font-medium text-slate-800">{t.subject}</td>
                    <td className="px-4 py-3 text-slate-600">{t.client?.name ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 text-slate-500">{new Date(t.lastReplyAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ContactCard({ ctx }: { ctx: ClientContext }) {
  const withManager = ctx.workspaces.find((w) => w.manager);
  const manager = withManager?.manager;
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
      {manager ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Your account manager</div>
          <div className="mt-1 font-semibold text-slate-800">{manager.name}</div>
          <div className="text-sm text-slate-600">
            {manager.email}{manager.phone ? ` · ${manager.phone}` : ''}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Support desk</div>
          <div className="mt-1 text-sm text-slate-600">
            {ctx.generic.email}{ctx.generic.phone ? ` · ${ctx.generic.phone}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function NewTicketForm({ ctx, onCancel, onCreated }: { ctx: ClientContext | null; onCancel: () => void; onCreated: (id: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const multi = (ctx?.workspaces.length ?? 0) > 1;

  useEffect(() => {
    if (ctx && ctx.workspaces.length === 1) setClientId(ctx.workspaces[0].id);
  }, [ctx]);

  async function submit() {
    if (!subject.trim() || !message.trim()) { setErr('Subject and message are required.'); return; }
    if (multi && !clientId) { setErr('Please choose a workspace.'); return; }
    if (file && file.size > 5 * 1024 * 1024) { setErr('File too large (max 5 MB).'); return; }
    setBusy(true); setErr('');
    try {
      const payload: Record<string, string> = { subject: subject.trim(), message: message.trim() };
      if (clientId) payload.clientId = clientId;
      if (file) {
        payload.attachmentBase64 = await fileToBase64(file);
        payload.attachmentName = file.name;
        payload.attachmentMime = file.type;
      }
      const { id } = await api.post<{ id: string }>('/support/my/tickets', payload);
      signalChanged();
      onCreated(id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to create ticket');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">New ticket</h2>
      {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      <div className="space-y-3">
        {multi && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Workspace</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
              <option value="">Choose…</option>
              {ctx?.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Attachment (optional — PDF, image, Word, Excel; max 5 MB)</span>
          <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-500" />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Submitting…' : 'Submit ticket'}
        </button>
      </div>
    </div>
  );
}

function ClientThread({ id, onBack }: { id: string; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get<Thread>(`/support/my/tickets/${id}`).then(setThread).catch((e) => setErr(e instanceof ApiError ? e.message : 'Not found'));
  }, [id]);

  useEffect(() => { load(); signalChanged(); }, [load]);

  async function reply(message: string, file: File | null) {
    const payload: Record<string, string> = { message };
    if (file) {
      payload.attachmentBase64 = await fileToBase64(file);
      payload.attachmentName = file.name;
      payload.attachmentMime = file.type;
    }
    await api.post(`/support/my/tickets/${id}/reply`, payload);
    load();
  }

  async function sendFeedback(satisfaction: 'SATISFIED' | 'NOT_SATISFIED') {
    const note = prompt('Add an optional note (leave blank to skip):') ?? undefined;
    await api.post(`/support/my/tickets/${id}/feedback`, { satisfaction, note });
    load();
  }

  if (err) return <div className="mx-auto max-w-3xl"><button onClick={onBack} className="mb-4 text-sm text-brand-700">← Back</button><div className="text-rose-600">{err}</div></div>;
  if (!thread) return <div className="p-8 text-slate-400">Loading…</div>;

  const closed = thread.status === 'CLOSED';
  const canRate = thread.status !== 'OPEN' && !thread.satisfaction;

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-4 text-sm font-medium text-brand-700">← Back to tickets</button>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800">{thread.subject}</h1>
            <p className="text-xs text-slate-500">
              {thread.client?.name} · {thread.handledBy ? `Handled by ${thread.handledBy.name}` : 'Awaiting assignment'}
            </p>
          </div>
          <StatusBadge status={thread.status} />
        </div>

        <MessageList messages={thread.messages} />

        {thread.satisfaction && (
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Your feedback: <strong>{thread.satisfaction === 'SATISFIED' ? '👍 Satisfied' : '👎 Not satisfied'}</strong>
            {thread.satisfactionNote ? ` — “${thread.satisfactionNote}”` : ''}
          </div>
        )}

        {canRate && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Was your issue resolved?</span>
            <button onClick={() => sendFeedback('SATISFIED')} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">👍 Satisfied</button>
            <button onClick={() => sendFeedback('NOT_SATISFIED')} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white">👎 Not satisfied</button>
          </div>
        )}

        <div className="mt-4">
          {closed ? (
            <div className="text-sm text-slate-400">This ticket is closed.</div>
          ) : (
            <Composer onSend={reply} />
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ STAFF / SALES CONSOLE ═══════════════════════════
interface StaffTicket {
  id: string; subject: string; status: string; satisfaction: string | null;
  escalatedAt: string | null; lastReplyAt: string; lastReplyRole: string; createdAt: string;
  user: { id: string; name: string; email: string } | null;
  client: { id: string; name: string; email: string | null; mobile: string | null } | null;
  assignedTo: { id: string; name: string; role: string } | null;
}
interface Handler { id: string; name: string; email: string; role: string }

function StaffSupport() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const activeId = params.get('ticket');

  const [tickets, setTickets] = useState<StaffTicket[]>([]);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [status, setStatus] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [handledBy, setHandledBy] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (escalated) qs.set('escalated', 'true');
    if (handledBy) qs.set('handledBy', handledBy);
    api.get<StaffTicket[]>(`/support/tickets${qs.toString() ? `?${qs}` : ''}`).then(setTickets).finally(() => setLoading(false));
  }, [status, escalated, handledBy]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Handler[]>('/support/handlers').then(setHandlers).catch(() => {}); }, []);

  if (activeId) {
    return <StaffThread id={activeId} handlers={handlers} isAdmin={user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN'} isSales={user?.role === 'SALES'} onBack={() => { router.push('/support'); load(); }} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-800">Client Support</h1>
      <p className="mb-5 text-sm text-slate-500">
        {user?.role === 'SALES' ? 'Tickets from your assigned clients.' : 'All client support tickets.'}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="ANSWERED">Answered</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select value={handledBy} onChange={(e) => setHandledBy(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="">Any handler</option>
          {handlers.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.role}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={escalated} onChange={(e) => setEscalated(e.target.checked)} /> Escalated only
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Handled by</th>
              <th className="px-4 py-3">Feedback</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No tickets.</td></tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/support?ticket=${t.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{t.subject}</div>
                    {t.escalatedAt && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">ESCALATED</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{t.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <div>{t.client?.email ?? t.user?.email ?? '—'}</div>
                    {t.client?.mobile && <div className="text-xs">{t.client.mobile}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-slate-600">{t.assignedTo ? `${t.assignedTo.name}` : '—'}</td>
                  <td className="px-4 py-3">
                    {t.satisfaction ? (t.satisfaction === 'SATISFIED' ? '👍' : '👎') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(t.lastReplyAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaffThread({ id, handlers, isAdmin, isSales, onBack }: { id: string; handlers: Handler[]; isAdmin: boolean; isSales: boolean; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [err, setErr] = useState('');
  const [assignee, setAssignee] = useState('');

  const load = useCallback(() => {
    api.get<Thread>(`/support/tickets/${id}`)
      .then((t) => { setThread(t); setAssignee(t.handledBy?.id ?? ''); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Not found'));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function reply(message: string, file: File | null) {
    const payload: Record<string, string> = { message };
    if (file) {
      payload.attachmentBase64 = await fileToBase64(file);
      payload.attachmentName = file.name;
      payload.attachmentMime = file.type;
    }
    await api.post(`/support/tickets/${id}/reply`, payload);
    signalChanged();
    load();
  }

  async function setStatus(status: string) {
    await api.patch(`/support/tickets/${id}`, { status });
    signalChanged();
    load();
  }

  async function reassign(assignedToId: string) {
    setAssignee(assignedToId);
    await api.patch(`/support/tickets/${id}`, { assignedToId });
    load();
  }

  async function escalate() {
    const note = prompt('Add a note for the admins (optional):') ?? undefined;
    await api.post(`/support/tickets/${id}/escalate`, { note });
    signalChanged();
    load();
  }

  async function resolveEscalation() {
    const note = prompt('Note for the salesperson (optional):') ?? undefined;
    await api.post(`/support/tickets/${id}/resolve-escalation`, { note });
    signalChanged();
    load();
  }

  if (err) return <div className="mx-auto max-w-3xl"><button onClick={onBack} className="mb-4 text-sm text-brand-700">← Back</button><div className="text-rose-600">{err}</div></div>;
  if (!thread) return <div className="p-8 text-slate-400">Loading…</div>;

  const closed = thread.status === 'CLOSED';

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={onBack} className="mb-4 text-sm font-medium text-brand-700">← Back to tickets</button>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* conversation */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-800">{thread.subject}</h1>
              <p className="text-xs text-slate-500">
                {thread.client?.name} · raised by {thread.raisedBy?.name}
              </p>
            </div>
            <StatusBadge status={thread.status} />
          </div>
          <MessageList messages={thread.messages} />
          <div className="mt-4">
            {closed ? <div className="text-sm text-slate-400">This ticket is closed.</div> : <Composer onSend={reply} />}
          </div>
        </div>

        {/* side panel */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</div>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Client</dt><dd className="text-slate-700">{thread.client?.name ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd className="text-slate-700">{thread.client?.email ?? thread.raisedBy?.email ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="text-slate-700">{thread.client?.mobile ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Handler</dt><dd className="text-slate-700">{thread.handledBy?.name ?? '—'}</dd></div>
            </dl>
            {thread.satisfaction && (
              <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                Feedback: <strong>{thread.satisfaction === 'SATISFIED' ? '👍 Satisfied' : '👎 Not satisfied'}</strong>
                {thread.satisfactionNote ? ` — “${thread.satisfactionNote}”` : ''}
              </div>
            )}
          </div>

          {/* escalation */}
          {thread.escalatedAt ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Escalated</div>
              {thread.escalatedBy && <div className="mt-1 text-sm text-slate-700">by {thread.escalatedBy.name}</div>}
              {thread.escalationNote && <div className="mt-1 text-sm text-slate-600">“{thread.escalationNote}”</div>}
              {isAdmin && (
                <button onClick={resolveEscalation} className="mt-3 w-full rounded-lg bg-brand-gradient px-3 py-2 text-sm font-semibold text-white">
                  Resolve escalation
                </button>
              )}
            </div>
          ) : (
            isSales && !closed && (
              <button onClick={escalate} className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Escalate to admin
              </button>
            )
          )}

          {/* admin controls */}
          {isAdmin && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Manage</div>
              <label className="mt-2 block text-sm">
                <span className="mb-1 block text-slate-600">Status</span>
                <select value={thread.status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5">
                  <option value="OPEN">Open</option>
                  <option value="ANSWERED">Answered</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>
              <label className="mt-2 block text-sm">
                <span className="mb-1 block text-slate-600">Handler</span>
                <select value={assignee} onChange={(e) => reassign(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5">
                  <option value="">— Unassigned —</option>
                  {handlers.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.role}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
