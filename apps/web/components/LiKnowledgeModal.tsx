'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal, Tabs } from '@/components/ui';
import { LiChatState, LiKnowledgeDetails } from '@/lib/linkedin';

export function LiKnowledgeModal({ profileId, title, onClose, base = '/linkedin' }: { profileId: string; title: string; onClose: () => void; base?: string }) {
  const [tab, setTab] = useState('chat');
  const [chat, setChat] = useState<LiChatState | null>(null);
  const [details, setDetails] = useState<LiKnowledgeDetails | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadChat = useCallback(async () => {
    setChat(await api.get<LiChatState>(`${base}/knowledge-profiles/${profileId}/chat`));
  }, [profileId, base]);
  const loadDetails = useCallback(async () => {
    setDetails(await api.get<LiKnowledgeDetails>(`${base}/knowledge-profiles/${profileId}/details`));
  }, [profileId, base]);

  useEffect(() => { loadChat(); }, [loadChat]);
  useEffect(() => { if (tab === 'details') loadDetails(); }, [tab, loadDetails]);

  async function answer(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await api.post(`${base}/knowledge-profiles/${profileId}/chat`, { text: value }); setText(''); await loadChat(); }
    finally { setBusy(false); }
  }

  const pct = chat?.completeness ?? 0;

  return (
    <Modal open onClose={onClose} title={title} wide disableBackdropClose>
      <div className="mb-3 flex items-center justify-between">
        <Tabs tabs={[{ key: 'chat', label: 'Chat' }, { key: 'details', label: 'Details' }]} active={tab} onChange={setTab} />
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pct >= 100 ? 'bg-emerald-100 text-emerald-700' : pct > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{pct}% complete</span>
      </div>

      {tab === 'chat' ? (
        <div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
            {chat?.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>{m.content}</div>
              </div>
            ))}
            {chat?.done && <div className="text-center text-xs font-medium text-emerald-600">Profile complete ✓</div>}
          </div>

          {chat?.current && (
            <div className="mt-3">
              {chat.current.options.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {chat.current.options.map((o) => (
                    <button key={o} disabled={busy} onClick={() => answer(o)} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700">{o}</button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input className="input" value={text} placeholder="Type your answer…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') answer(text); }} />
                <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => answer(text)}>Send</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-96 space-y-4 overflow-y-auto">
          {details?.sections.map((s) => (
            <div key={s.section}>
              <div className="mb-1 text-sm font-semibold text-slate-700">{s.section}</div>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {s.fields.map((f) => (
                  <div key={f.key} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
                    <span className="text-slate-500">{f.label}</span>
                    <span className={`max-w-[60%] text-right ${f.collected ? 'text-slate-800' : 'italic text-slate-300'}`}>{f.collected ? String(f.value) : 'Not yet collected'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
