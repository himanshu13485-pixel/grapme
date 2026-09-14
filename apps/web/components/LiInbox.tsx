'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, Modal, Tabs } from '@/components/ui';
import { LiInboxItem, LiInboxCounts, LiThread, LinkedInAccount } from '@/lib/linkedin';

const SENTIMENT_CLS: Record<string, string> = {
  POSITIVE: 'bg-emerald-100 text-emerald-700',
  NEUTRAL: 'bg-slate-100 text-slate-600',
  NEGATIVE: 'bg-rose-100 text-rose-700',
};

export function LiInbox({ clientId, base = '/linkedin' }: { clientId: string; base?: string }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState<LiInboxItem[]>([]);
  const [counts, setCounts] = useState<LiInboxCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [accountId, setAccountId] = useState('');

  // Seats (LinkedIn accounts) for the per-seat filter.
  useEffect(() => {
    api.get<LinkedInAccount[]>(`${base}/clients/${clientId}/linkedin-accounts`).then(setAccounts).catch(() => {});
  }, [clientId, base]);

  const load = useCallback(async () => {
    const acc = accountId ? `?accountId=${accountId}` : '';
    const [list, cnt] = await Promise.all([
      api.get<{ items: LiInboxItem[] }>(`${base}/clients/${clientId}/inbox?tab=${tab}${accountId ? `&accountId=${accountId}` : ''}`),
      api.get<LiInboxCounts>(`${base}/clients/${clientId}/inbox/counts${acc}`),
    ]);
    setItems(list.items); setCounts(cnt); setLoaded(true);
  }, [clientId, tab, accountId, base]);
  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: 'all', label: 'All', count: counts?.all },
    { key: 'unread', label: 'Unread', count: counts?.unread },
    { key: 'needs_reply', label: 'Needs reply', count: counts?.needsReply },
    { key: 'replied', label: 'Replied', count: counts?.replied },
  ];

  return (
    <div>
      {accounts.length > 1 && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-xs text-slate-400">Seat</span>
          <select className="input w-56 py-1 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All seats</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.fullName ?? 'LinkedIn account'}</option>)}
          </select>
        </div>
      )}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {!loaded ? <EmptyState message="Loading…" /> : items.length === 0 ? (
        <EmptyState message="No replies in this view yet." />
      ) : (
        <div className="card divide-y divide-slate-100">
          {items.map((it) => (
            <button key={it.conversationId} onClick={() => setOpenId(it.conversationId)} className="flex w-full items-center justify-between p-4 text-left transition hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <img src={it.lead.avatarUrl || 'https://placehold.co/40x40/ede9fe/6d28d9?text=in'} alt="" className="h-10 w-10 rounded-full bg-brand-50 object-cover" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{it.lead.fullName}</span>
                    {it.lead.sentiment && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SENTIMENT_CLS[it.lead.sentiment]}`}>{it.lead.sentiment}</span>}
                    {it.account?.fullName && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500" title="LinkedIn seat">👤 {it.account.fullName}</span>}
                  </div>
                  <div className="line-clamp-1 text-xs text-slate-500">{it.lead.title ? `${it.lead.title} · ` : ''}{it.lead.company ?? ''}{it.lead.location ? ` · ${it.lead.location}` : ''}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {it.lastReplyAt && <span>{new Date(it.lastReplyAt).toLocaleDateString()}</span>}
                {it.unreadCount > 0 && <span className="rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-700">{it.unreadCount} new</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && <ThreadModal base={base} conversationId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

export function ThreadModal({ conversationId, onClose, base }: { conversationId: string; onClose: () => void; base: string }) {
  const [thread, setThread] = useState<LiThread | null>(null);
  const [text, setText] = useState('');
  const [usedAi, setUsedAi] = useState(false);
  const [busy, setBusy] = useState<'' | 'ai' | 'send'>('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const t = await api.get<LiThread>(`${base}/conversations/${conversationId}`);
    setThread(t);
    await api.post(`${base}/conversations/${conversationId}/read`).catch(() => {});
    const draft = t.lead.aiFetches?.[0]?.draftReply;
    if (draft && !text) { setText(draft); setUsedAi(true); }
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function aiFetch() {
    setBusy('ai'); setErr('');
    try {
      const f = await api.post<{ draftReply?: string; intent?: string; sentiment?: string }>(`${base}/conversations/${conversationId}/ai-fetch`);
      if (f.draftReply) { setText(f.draftReply); setUsedAi(true); }
      await load();
    } catch (e: any) { setErr(e.message ?? 'AI Fetch failed'); }
    finally { setBusy(''); }
  }
  async function send() {
    if (!text.trim()) return;
    setBusy('send'); setErr('');
    try {
      const r = await api.post<{ pendingApproval?: boolean; message?: string }>(`${base}/conversations/${conversationId}/reply`, { text, source: usedAi ? 'AI' : 'MANUAL' });
      if (r?.pendingApproval) alert(r.message ?? 'Reply sent for approval.');
      setText(''); setUsedAi(false);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Send failed'); }
    finally { setBusy(''); }
  }

  const fetchInfo = thread?.lead.aiFetches?.[0];

  return (
    <Modal open onClose={onClose} title={thread?.lead.fullName ?? 'Conversation'} wide>
      {!thread ? <div className="p-6 text-slate-400">Loading…</div> : (
        <div>
          <div className="mb-3 text-sm text-slate-500">{thread.lead.title ? `${thread.lead.title} · ` : ''}{thread.lead.company ?? ''}</div>

          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
            {thread.messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'OUTBOUND' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>
                  {m.body}
                  <div className={`mt-1 text-[10px] ${m.direction === 'OUTBOUND' ? 'text-white/60' : 'text-slate-400'}`}>{new Date(m.sentAt).toLocaleString()} · {m.source}</div>
                </div>
              </div>
            ))}
          </div>

          {fetchInfo && (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-slate-600">
              AI analysis · intent <b>{fetchInfo.intent ?? '—'}</b> · sentiment <b>{fetchInfo.sentiment ?? '—'}</b>
            </div>
          )}

          {err && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

          <div className="mt-3">
            <textarea className="input" rows={3} value={text} onChange={(e) => { setText(e.target.value); }} placeholder="Type a reply…" />
            <div className="mt-2 flex items-center justify-between">
              <button className="btn-ghost" disabled={busy !== ''} onClick={aiFetch}>
                {busy === 'ai' ? 'Analyzing…' : '✦ AI Fetch (1 credit)'}
              </button>
              <button className="btn-primary" disabled={busy !== '' || !text.trim()} onClick={send}>
                {busy === 'send' ? 'Sending…' : 'Send Reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
