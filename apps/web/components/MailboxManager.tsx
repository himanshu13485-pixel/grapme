'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, useCanDelete } from '@/lib/auth';
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
  emailAccount?: { id?: string; emailAddress: string; label?: string };
}

interface MailboxOption {
  id: string;
  emailAddress: string;
  label?: string;
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
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'; // bulk delete is super-admin only
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabKey>('inbox');
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [syncNote, setSyncNote] = useState('');
  const [page, setPage] = useState(1);
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [mailboxFilter, setMailboxFilter] = useState(''); // '' = all registered mailboxes

  const isInbox = tab === 'inbox';
  const isFailed = tab === 'failed';
  const PAGE_SIZE = 25;
  const pageCount = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = messages.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // clientId scope (used by sync / mark-read); the list also adds the mailbox filter.
  const scopeQ = clientId ? `?clientId=${clientId}` : '';

  // Populate the "From mailbox" filter with the registered mailboxes in scope.
  useEffect(() => {
    api
      .get<MailboxOption[]>(`/email-accounts${scopeQ}`)
      .then(setMailboxes)
      .catch(() => setMailboxes([]));
    setMailboxFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function load() {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (mailboxFilter) params.set('mailbox', mailboxFilter);
    const listQ = params.toString() ? `?${params.toString()}` : '';
    setRefreshing(true);
    try {
      const data = await api.get<Message[]>(`/mailbox/${tab}${listQ}`);
      setMessages(data);
      // Viewing the Inbox marks its replies read, clearing the badge/alert.
      if (tab === 'inbox') {
        await api.post(`/mailbox/mark-read${scopeQ}`).catch(() => {});
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
    setSelected(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId, mailboxFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allOnPageSelected = paged.length > 0 && paged.every((m) => selected.has(m.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) paged.forEach((m) => next.delete(m.id));
      else paged.forEach((m) => next.add(m.id));
      return next;
    });
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} selected message${ids.length === 1 ? '' : 's'}?`)) return;
    try {
      await api.post('/mailbox/bulk-delete', { ids });
      setMessages((prev) => prev.filter((m) => !selected.has(m.id)));
      setSelected(new Set());
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('inbox-read'));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk delete failed');
    }
  }

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
        {isSuperAdmin && selected.size > 0 && (
          <button
            className="btn-ghost text-xs text-rose-600"
            onClick={bulkDelete}
            title="Permanently delete the selected messages"
          >
            🗑 Delete selected ({selected.size})
          </button>
        )}
        {mailboxes.length > 1 && (
          <select
            value={mailboxFilter}
            onChange={(e) => setMailboxFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:border-brand-400 focus:outline-none"
            title="Filter by the mailbox that sent/received the message"
          >
            <option value="">All mailboxes</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.emailAddress}
              </option>
            ))}
          </select>
        )}
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
                {isSuperAdmin && (
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectPage}
                      title="Select all on this page"
                      aria-label="Select all on this page"
                    />
                  </th>
                )}
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
                    {isSuperAdmin && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                          aria-label="Select message"
                        />
                      </td>
                    )}
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
                      <td colSpan={(canDelete || isFailed ? 6 : 5) + (isSuperAdmin ? 1 : 0)} className="px-6 py-4">
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
