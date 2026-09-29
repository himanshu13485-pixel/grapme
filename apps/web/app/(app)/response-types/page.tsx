'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, EmptyState } from '@/components/ui';

interface ResponseType {
  id: string;
  category: string;
  note?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  body?: string | null;
  createdAt: string;
}

/** Plain-text preview of a stored reply (inbound mail can carry HTML). */
function preview(body?: string | null): string {
  if (!body) return '';
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/**
 * Examples of the kinds of reply buyers send, saved from the Inbox. Staff
 * reference for showing a client what responses campaigns get.
 */
export default function ResponseTypesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN';
  const [items, setItems] = useState<ResponseType[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ResponseType[]>('/response-types')
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  useEffect(load, [load]);

  async function rename(r: ResponseType) {
    const category = prompt('Response type', r.category)?.trim();
    if (!category || category === r.category) return;
    try {
      await api.patch(`/response-types/${r.id}`, { category });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function editNote(r: ResponseType) {
    const note = prompt('Note shown with this example', r.note ?? '');
    if (note === null) return;
    try {
      await api.patch(`/response-types/${r.id}`, { note });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function remove(r: ResponseType) {
    if (!confirm(`Remove the example "${r.category}"?`)) return;
    try {
      await api.del(`/response-types/${r.id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Response Type"
        subtitle="The kinds of reply buyers send — saved from the Inbox, to show clients what campaigns bring in"
      />

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {items.length === 0 ? (
        <EmptyState
          message={
            canEdit
              ? 'No examples yet. Open Inbox & Sent, expand a reply and choose "Save as response type".'
              : 'No examples yet. Your admin adds them from the Inbox.'
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                    {r.category}
                  </span>
                  <div className="mt-2 font-medium text-slate-800">{r.subject || '(no subject)'}</div>
                  <div className="text-xs text-slate-400">
                    {r.fromAddress || 'unknown sender'} · saved{' '}
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                  {r.note && <div className="mt-2 text-sm text-slate-600">{r.note}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    {open === r.id ? 'Hide reply' : 'Show reply'}
                  </button>
                  {canEdit && (
                    <>
                      <button className="btn-ghost text-xs" onClick={() => rename(r)}>
                        Rename
                      </button>
                      <button className="btn-ghost text-xs" onClick={() => editNote(r)}>
                        Note
                      </button>
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => remove(r)}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
              {open === r.id && (
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {preview(r.body) || 'This reply had no readable text.'}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
