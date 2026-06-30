'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Message {
  id: string;
  subject?: string;
  body?: string;
  status: string;
  sentAt?: string;
  createdAt: string;
  fromAddress?: string;
  contact?: { email: string };
  campaign?: { name: string };
  emailAccount?: { emailAddress: string; label?: string };
}

const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'failed', label: 'Failed' },
  { key: 'drafts', label: 'Drafts' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Inbox / Sent / etc. across mailboxes. When `clientId` is set, only that
 *  client's mail (its mailboxes + contacts) is shown. */
export function MailboxManager({ clientId }: { clientId?: string }) {
  const [tab, setTab] = useState<TabKey>('inbox');
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  function load() {
    const q = clientId ? `?clientId=${clientId}` : '';
    api
      .get<Message[]>(`/mailbox/${tab}${q}`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }
  useEffect(load, [tab, clientId]);

  const isInbox = tab === 'inbox';

  const header = (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setOpen(null);
            }}
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
      <button className="btn-ghost text-xs" onClick={load}>
        ↻ Refresh
      </button>
    </div>
  );

  return (
    <div>
      {!clientId && (
        <PageHeader title="Inbox & Sent" subtitle="Messages across your mailboxes" />
      )}
      {header}

      {messages.length === 0 ? (
        <EmptyState
          message={
            isInbox
              ? 'No replies yet. Incoming mail from receivers appears here once your mailboxes poll it.'
              : `No ${tab} messages.`
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">{isInbox ? 'From' : 'Contact'}</th>
                <th className="px-5 py-3">Subject</th>
                <th className="px-5 py-3">{isInbox ? 'To mailbox' : 'Campaign'}</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <Fragment key={m.id}>
                  <tr
                    className={`border-t border-slate-100 ${isInbox ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                    onClick={() => isInbox && setOpen(open === m.id ? null : m.id)}
                  >
                    <td className="px-5 py-3 font-medium">
                      {isInbox
                        ? (m.fromAddress ?? m.contact?.email ?? '—')
                        : (m.contact?.email ?? '—')}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {isInbox && <span className="mr-1 text-slate-400">{open === m.id ? '▾' : '▸'}</span>}
                      {m.subject ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {isInbox
                        ? (m.emailAccount?.emailAddress ?? '—')
                        : (m.campaign?.name ?? '—')}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{m.status}</td>
                    <td className="px-5 py-3 text-slate-400">
                      {new Date(m.sentAt ?? m.createdAt).toLocaleString()}
                    </td>
                  </tr>
                  {isInbox && open === m.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-6 py-4">
                        <div className="mb-2 text-xs text-slate-400">
                          From {m.fromAddress ?? '—'} · received{' '}
                          {new Date(m.createdAt).toLocaleString()}
                        </div>
                        <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
                          {m.body?.trim() ? m.body : '(no message body captured)'}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isInbox && (
        <p className="mt-3 text-xs text-slate-400">
          Replies are pulled from each mailbox over IMAP. Click a row to read the
          full message. A reply also auto-stops that contact&apos;s follow-up
          sequence.
        </p>
      )}
    </div>
  );
}
