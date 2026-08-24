'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePlans } from '@/lib/plans';
import { RichText } from '@/components/RichText';
import { PageHeader } from '@/components/ui';

const DEFAULT_SIGNATURE =
  '<p>Warm regards,<br/><strong>Team GrapMe</strong><br/>Admin &amp; Support</p>';

interface Broadcast {
  id: string;
  title: string;
  status: 'DRAFT' | 'SENT';
  audienceLabel: string | null;
  showInApp: boolean;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  sendTelegram: boolean;
  sendNetvork: boolean;
  recipientCount: number;
  createdByName: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface BroadcastFull extends Broadcast {
  bodyHtml: string;
  signatureHtml: string | null;
  audience: 'ALL' | 'CHANNEL' | 'PLAN' | 'CLIENT';
  channel: string | null;
  plan: string | null;
  clientId: string | null;
}

export default function BroadcastsPage() {
  const { planNames } = usePlans();
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [sent, setSent] = useState<Broadcast[]>([]);

  // form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0); // bump to force the RichText editors to re-seed
  const [title, setTitle] = useState('');
  const [audienceKey, setAudienceKey] = useState('ALL');
  const [clientId, setClientId] = useState('');
  const [showInApp, setShowInApp] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [sendTelegram, setSendTelegram] = useState(false);
  const [sendNetvork, setSendNetvork] = useState(false);
  const [bodyHtml, setBodyHtml] = useState('');
  const [signatureHtml, setSignatureHtml] = useState(DEFAULT_SIGNATURE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState<BroadcastFull | null>(null);

  const loadList = () => api.get<Broadcast[]>('/broadcasts').then(setSent).catch(() => {});
  useEffect(() => {
    loadList();
    api.get<{ id: string; name: string }[]>('/clients').then((cs) => setClients(cs.map((c) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, []);

  const audienceOptions = useMemo(
    () => [
      { key: 'ALL', label: 'All clients' },
      { key: 'CHANNEL:EMAIL', label: 'Email clients' },
      { key: 'CHANNEL:LINKEDIN', label: 'LinkedIn clients' },
      ...planNames.map((p) => ({ key: `PLAN:${p}`, label: `Plan — ${p}` })),
      { key: 'CLIENT', label: 'A specific client (one-on-one)' },
    ],
    [planNames],
  );

  function payloadAudience() {
    if (audienceKey === 'ALL') return { audience: 'ALL' as const };
    if (audienceKey.startsWith('CHANNEL:'))
      return { audience: 'CHANNEL' as const, channel: audienceKey.split(':')[1] as 'EMAIL' | 'LINKEDIN' };
    if (audienceKey.startsWith('PLAN:')) return { audience: 'PLAN' as const, plan: audienceKey.slice(5) };
    return { audience: 'CLIENT' as const, clientId };
  }

  function buildPayload() {
    return { title, bodyHtml, signatureHtml, ...payloadAudience(), showInApp, sendEmail, sendWhatsapp, sendTelegram, sendNetvork };
  }

  function resetForm() {
    setEditingId(null);
    setTitle(''); setAudienceKey('ALL'); setClientId('');
    setShowInApp(true); setSendEmail(true); setSendWhatsapp(false); setSendTelegram(false);
    setBodyHtml(''); setSignatureHtml(DEFAULT_SIGNATURE);
    setEditorKey((k) => k + 1);
    setMsg(''); setErr('');
  }

  async function loadDraft(id: string) {
    setErr(''); setMsg('');
    try {
      const b = await api.get<BroadcastFull>(`/broadcasts/drafts/${id}`);
      setEditingId(b.id);
      setTitle(b.title);
      setAudienceKey(
        b.audience === 'CHANNEL' ? `CHANNEL:${b.channel}` :
        b.audience === 'PLAN' ? `PLAN:${b.plan}` :
        b.audience === 'CLIENT' ? 'CLIENT' : 'ALL',
      );
      setClientId(b.clientId ?? '');
      setShowInApp(b.showInApp); setSendEmail(b.sendEmail); setSendWhatsapp(b.sendWhatsapp); setSendTelegram(b.sendTelegram);
      setSendNetvork(b.sendNetvork);
      setBodyHtml(b.bodyHtml); setSignatureHtml(b.signatureHtml ?? '');
      setEditorKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load draft');
    }
  }

  async function view(id: string) {
    try {
      setViewing(await api.get<BroadcastFull>(`/broadcasts/drafts/${id}`));
    } catch { /* ignore */ }
  }

  function checkChannels() {
    if (!showInApp && !sendEmail && !sendWhatsapp) {
      setErr('Pick at least one delivery channel (in-app, email, or WhatsApp).');
      return false;
    }
    return true;
  }

  async function saveDraft() {
    setErr(''); setMsg('');
    if (!title.trim()) return setErr('Add a title to save a draft.');
    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/broadcasts/drafts/${editingId}`, buildPayload());
      } else {
        const { id } = await api.post<{ id: string }>('/broadcasts/drafts', buildPayload());
        setEditingId(id);
      }
      setMsg('Draft saved.');
      loadList();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save draft');
    } finally { setBusy(false); }
  }

  async function send() {
    setErr(''); setMsg('');
    if (!title.trim()) return setErr('Add a title.');
    if (!bodyHtml.replace(/<[^>]+>/g, '').trim()) return setErr('Add a message body.');
    if (audienceKey === 'CLIENT' && !clientId) return setErr('Choose a specific client.');
    if (!checkChannels()) return;
    setBusy(true);
    try {
      let res: { recipientCount: number };
      if (editingId) {
        await api.patch(`/broadcasts/drafts/${editingId}`, buildPayload());
        res = await api.post<{ recipientCount: number }>(`/broadcasts/drafts/${editingId}/send`);
      } else {
        res = await api.post<{ recipientCount: number }>('/broadcasts', buildPayload());
      }
      setMsg(`Sent to ${res.recipientCount} client${res.recipientCount === 1 ? '' : 's'}.`);
      resetForm();
      loadList();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to send');
    } finally { setBusy(false); }
  }

  async function delDraft(id: string) {
    if (!confirm('Delete this draft?')) return;
    await api.del(`/broadcasts/drafts/${id}`);
    if (editingId === id) resetForm();
    loadList();
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Notifications" subtitle="Broadcast a notification to your clients' portal." />

      <div className="card mb-8 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{editingId ? 'Edit draft' : 'Create broadcast'}</h2>
          {editingId && <button onClick={resetForm} className="text-sm font-medium text-slate-500 hover:text-slate-700">Start new</button>}
        </div>
        {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

        <div className="space-y-4">
          <div>
            <label className="label">Title / Subject *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance this weekend" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Send to *</label>
              <select className="input" value={audienceKey} onChange={(e) => setAudienceKey(e.target.value)}>
                {audienceOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            {audienceKey === 'CLIENT' && (
              <div>
                <label className="label">Specific client *</label>
                <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 px-4 py-3">
            <Toggle label="Show in-app (notification bell)" checked={showInApp} onChange={setShowInApp} />
            <Toggle label="Send email" checked={sendEmail} onChange={setSendEmail} />
            <Toggle label="Send WhatsApp" checked={sendWhatsapp} onChange={setSendWhatsapp} />
            <Toggle label="Send Telegram" checked={sendTelegram} onChange={setSendTelegram} />
            <Toggle label="Send Netvork" checked={sendNetvork} onChange={setSendNetvork} />
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            Email &amp; WhatsApp also respect each client&apos;s own notification preferences. The in-app
            Notification page always receives it.
          </p>

          <div>
            <label className="label">Message body *</label>
            <RichText key={`body-${editorKey}`} value={bodyHtml} onChange={setBodyHtml} placeholder="Write your notification… (bold, lists, links supported)" />
          </div>

          <div>
            <label className="label">Signature (HTML)</label>
            <RichText key={`sig-${editorKey}`} value={signatureHtml} onChange={setSignatureHtml} placeholder="Your sign-off…" />
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" disabled={busy} onClick={saveDraft}>
              {busy ? '…' : editingId ? 'Update draft' : 'Save draft'}
            </button>
            <button className="btn-primary" disabled={busy} onClick={send}>
              {busy ? 'Sending…' : 'Send broadcast'}
            </button>
          </div>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-800">Broadcasts</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Audience</th>
              <th className="px-4 py-3">Channels</th>
              <th className="px-4 py-3 text-center">Recipients</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sent.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No broadcasts yet.</td></tr>
            ) : (
              sent.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.title || <span className="text-slate-400">(untitled)</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.status === 'DRAFT' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {b.status === 'DRAFT' ? 'Draft' : 'Sent'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{b.audienceLabel ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 text-[10px] font-semibold">
                      {b.showInApp && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">In-app</span>}
                      {b.sendEmail && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-700">Email</span>}
                      {b.sendWhatsapp && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">WhatsApp</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">{b.status === 'SENT' ? b.recipientCount : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {b.status === 'DRAFT' ? (
                      <div className="flex justify-end gap-3 text-sm font-medium">
                        <button onClick={() => loadDraft(b.id)} className="text-brand-700 hover:underline">Edit</button>
                        <button onClick={() => delDraft(b.id)} className="text-rose-600 hover:underline">Delete</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs text-slate-400">{b.sentAt ? new Date(b.sentAt).toLocaleDateString() : ''}</span>
                        <button onClick={() => view(b.id)} className="text-sm font-medium text-brand-700 hover:underline">View</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
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
              <span>To: <strong className="text-slate-700">{viewing.audienceLabel ?? '—'}</strong></span>
              <span>Recipients: <strong className="text-slate-700">{viewing.recipientCount}</strong></span>
              <span>Sent: <strong className="text-slate-700">{viewing.sentAt ? new Date(viewing.sentAt).toLocaleString() : '—'}</strong></span>
              <span>By: <strong className="text-slate-700">{viewing.createdByName ?? '—'}</strong></span>
            </div>
            <div className="mb-4 flex gap-1 text-[10px] font-semibold">
              {viewing.showInApp && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">In-app</span>}
              {viewing.sendEmail && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-700">Email</span>}
              {viewing.sendWhatsapp && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">WhatsApp</span>}
              {viewing.sendTelegram && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">Telegram</span>}
              {viewing.sendNetvork && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">Netvork</span>}
            </div>
            <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: viewing.bodyHtml }} />
            {viewing.signatureHtml && (
              <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: viewing.signatureHtml }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
