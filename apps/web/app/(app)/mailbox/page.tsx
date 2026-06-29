'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Message {
  id: string;
  subject?: string;
  status: string;
  sentAt?: string;
  createdAt: string;
  fromAddress?: string;
  contact?: { email: string };
  campaign?: { name: string };
}

const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'failed', label: 'Failed' },
  { key: 'drafts', label: 'Drafts' },
] as const;

export default function MailboxPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('sent');
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    api.get<Message[]>(`/mailbox/${tab}`).then(setMessages).catch(() => setMessages([]));
  }, [tab]);

  return (
    <div>
      <PageHeader title="Inbox & Sent" subtitle="Messages across your mailboxes" />

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {messages.length === 0 ? (
        <EmptyState message={`No ${tab} messages.`} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">{tab === 'inbox' ? 'From' : 'Contact'}</th>
                <th className="px-5 py-3">Subject</th>
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">
                    {m.contact?.email ?? m.fromAddress ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {m.subject ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {m.campaign?.name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{m.status}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(m.sentAt ?? m.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
