'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
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
  const canDelete = useCanDelete();
  const [tab, setTab] = useState<TabKey>('inbox');
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [syncNote, setSyncNote] = useState('');
  const [page, setPage] = useState(1);

  const isInbox = tab === 'inbox';
  const isFailed = tab === 'failed';
  const PAGE_SIZE = 25;
  const pageCount = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = messages.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  async function load() {
    const q = clientId ? `?clientId=${clientId}` : '';
    setRefreshing(true);
    try {
      const data = await api.get<Message[]>(`/mailbox/${tab}${q}`);
      setMessages(data);
      // Viewing the Inbox marks its replies read, clearing the badge/alert.
      if (tab === 'inbox') {
        await api.post(`/mailbox/mark-read${q}`).catch(() => {});
        if (typeof window !== 'undefined')
          window.dispatchEvent(new Event('inbox-read'));
      }
    } catch {
      setMessages([]);
    } finally {
      setRefreshing(false);
      setUpdatedAt(new Date());
    }
  }
  useEffect(() => {
    setPage(1);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId]);

  async function deleteMessage(id: string) {
    if (!confirm('Delete this message permanently?')) return;
    try {
      const r = await api.del<{ deleted?: boolean; pendingApproval?: boolean }>(
        `/mailbox/${id}`,
      );
      if (r?.pendingApproval) {
        alert('Delete request sent to a super admin for approval.');
        return;
      }
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('inbox-read'));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function resendMessage(id: string) {
    try {
      await api.post(`/mailbox/${id}/resend`, {});
      setMessages((prev) => prev.filter((m) => m.id !== id)); // no longer failed
      alert('Email resent.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not resend');
    }
  }
  async function resendAll() {
    if (!confirm('Queue all failed emails for a background resend? (Bounced / suppressed addresses are skipped automatically.)')) return;
    try {
      const q = clientId ? `?clientId=${clientId}` : '';
      const r = await api.post<{ queued: number }>(`/mailbox/resend-failed${q}`, {});
      alert(`Queued ${r.queued} email${r.queued === 1 ? '' : 's'} for background resend — they'll leave the Failed tab as they go out.`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not resend');
    }
  }

  // Pulls new mail straight from IMAP now (instead of waiting for the ~5-min
  // background poll), then reloads the list.
  async function syncNow() {
    const q = clientId ? `?clientId=${clientId}` : '';
    setSyncing(true);
    setSyncNote('');
    try {
      const res = await api.post<{
        scanned: number;
        stored: number;
        errors: string[];
      }>(`/mailbox/sync${q}`);
      if (res.errors?.length) {
        setSyncNote(`Error: ${res.errors[0]}`);
      } else if (res.scanned === 0) {
        setSyncNote('No active IMAP mailbox to pull from.');
      } else {
        setSyncNote(
          res.stored > 0
            ? `${res.stored} new message(s) pulled.`
            : 'No new mail since last sync.',
        );
      }
      await load();
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

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
      <div className="flex items-center gap-3">
        {syncNote && <span className="text-xs text-slate-400">{syncNote}</span>}
        {updatedAt && (
          <span className="text-xs text-slate-400">
            Updated {updatedAt.toLocaleTimeString()}
          </span>
        )}
        {isInbox && (
          <button
            className="btn-primary text-xs"
            onClick={syncNow}
            disabled={syncing}
            title="Pull new replies from the mail server now"
          >
            <span className={syncing ? 'inline-block animate-spin' : ''}>⟳</span>{' '}
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        {isFailed && messages.some((m) => m.status === 'FAILED') && (
          <button className="btn-primary text-xs" onClick={resendAll} title="Retry failed sends (skips bounced/suppressed)">
            ↻ Resend all
          </button>
        )}
        <button
          className="btn-ghost text-xs"
          onClick={load}
          disabled={refreshing}
        >
          <span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span>{' '}
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
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
                {(canDelete || isFailed) && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => (
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
                    {(canDelete || isFailed) && (
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isFailed && m.status === 'FAILED' && (
                            <button
                              className="btn-ghost text-xs text-brand-600"
                              onClick={(e) => { e.stopPropagation(); resendMessage(m.id); }}
                            >
                              Resend
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn-ghost text-xs text-rose-600"
                              onClick={(e) => { e.stopPropagation(); deleteMessage(m.id); }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {isInbox && open === m.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={canDelete ? 6 : 5} className="px-6 py-4">
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
          {messages.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>
                Showing {(pageSafe - 1) * PAGE_SIZE + 1}–
                {Math.min(pageSafe * PAGE_SIZE, messages.length)} of {messages.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost px-3 py-1 disabled:opacity-40"
                  onClick={() => {
                    setOpen(null);
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={pageSafe <= 1}
                >
                  ← Prev
                </button>
                <span>
                  Page {pageSafe} / {pageCount}
                </span>
                <button
                  className="btn-ghost px-3 py-1 disabled:opacity-40"
                  onClick={() => {
                    setOpen(null);
                    setPage((p) => Math.min(pageCount, p + 1));
                  }}
                  disabled={pageSafe >= pageCount}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isInbox && (
        <p className="mt-3 text-xs text-slate-400">
          Replies are pulled from each mailbox over IMAP automatically every few
          minutes — hit <strong>Sync now</strong> to pull immediately. Click a row
          to read the full message. A reply also auto-stops that contact&apos;s
          follow-up sequence.
        </p>
      )}
    </div>
  );
}
