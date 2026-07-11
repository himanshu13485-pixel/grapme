'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Tabs, Pagination } from '@/components/ui';
import { LiGlobalInboxItem, LiInboxCounts } from '@/lib/linkedin';
import { ThreadModal } from '@/components/LiInbox';

const SENTIMENT_CLS: Record<string, string> = {
  POSITIVE: 'bg-emerald-100 text-emerald-700',
  NEUTRAL: 'bg-slate-100 text-slate-600',
  NEGATIVE: 'bg-rose-100 text-rose-700',
};
const PAGE_SIZE = 25;

/** Admin cross-client LinkedIn inbox: every client's replies in one place. */
export default function LinkedInInboxPage() {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState<LiGlobalInboxItem[]>([]);
  const [counts, setCounts] = useState<LiInboxCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [dq, tab]);

  const load = useCallback(async () => {
    const clientParam = dq ? `&client=${encodeURIComponent(dq)}` : '';
    const [list, cnt] = await Promise.all([
      api.get<{ items: LiGlobalInboxItem[]; total: number }>(`/linkedin/inbox?tab=${tab}&page=${page}&pageSize=${PAGE_SIZE}${clientParam}`),
      api.get<LiInboxCounts>(`/linkedin/inbox/counts${dq ? `?client=${encodeURIComponent(dq)}` : ''}`),
    ]);
    setItems(list.items); setTotal(list.total); setCounts(cnt); setLoaded(true);
  }, [tab, page, dq]);
  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: 'all', label: 'All', count: counts?.all },
    { key: 'unread', label: 'Unread', count: counts?.unread },
    { key: 'needs_reply', label: 'Needs reply', count: counts?.needsReply },
    { key: 'replied', label: 'Replied', count: counts?.replied },
  ];

  return (
    <div>
      <PageHeader
        title="LinkedIn Inbox"
        subtitle="Every client's LinkedIn replies in one place."
      />

      <div className="mb-4">
        <input
          className="input max-w-sm"
          placeholder="Filter by client, company, invoice, contact, or seat…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : items.length === 0 ? (
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
                  {it.client && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                      <Link href={`/linkedin/${it.client.id}?tab=inbox`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">
                        {it.client.name}
                      </Link>
                      {it.client.company && <span className="text-slate-400">· {it.client.company}</span>}
                      {it.client.invoice && <span className="text-slate-400">· #{it.client.invoice}</span>}
                    </div>
                  )}
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

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {openId && <ThreadModal base="/linkedin" conversationId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}
