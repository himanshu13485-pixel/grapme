'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fetchBlob } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
import { PageHeader, EmptyState } from '@/components/ui';

interface DuplicateRow {
  id: string;
  email: string;
  fileName: string | null;
  newListName: string | null;
  newCompany: string | null;
  existingListNames: string | null;
  existingCompany: string | null;
  createdAt: string;
}

export default function DuplicateEmailsPage() {
  const canDelete = useCanDelete();
  const [rows, setRows] = useState<DuplicateRow[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = query ? `?search=${encodeURIComponent(query)}` : '';
      setRows(await api.get<DuplicateRow[]>(`/duplicate-emails${qs}`));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    try {
      const qs = query ? `?search=${encodeURIComponent(query)}` : '';
      const blob = await fetchBlob(`/duplicate-emails/export${qs}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'duplicate-emails.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Could not download the report.');
    }
  }

  async function removeRow(id: string) {
    if (!confirm('Remove this entry from the duplicate report?')) return;
    try {
      await api.del(`/duplicate-emails/${id}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function clearAll() {
    if (!confirm('Clear the entire duplicate report? This cannot be undone.')) return;
    setBusy(true);
    try {
      const qs = query ? `?search=${encodeURIComponent(query)}` : '';
      await api.del(`/duplicate-emails/clear${qs}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not clear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Duplicate Email"
        subtitle="Emails skipped on import because they already existed in another list — which file they came in on, and where they already live."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
          className="flex flex-1 items-center gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, file, list or company…"
            className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <button type="submit" className="btn-ghost text-sm">Search</button>
          {query && (
            <button type="button" className="btn-ghost text-sm text-slate-400" onClick={() => { setSearch(''); setQuery(''); }}>
              Clear
            </button>
          )}
        </form>
        <button className="btn-primary text-sm" onClick={downloadCsv} disabled={rows.length === 0}>
          ⬇ Download CSV
        </button>
        {canDelete && rows.length > 0 && (
          <button className="btn-ghost text-sm text-rose-600" onClick={clearAll} disabled={busy}>
            Clear all
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState message="No duplicate emails recorded yet. They appear here after an approved import contains addresses that already exist in the tenant." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">File Name</th>
                <th className="px-5 py-3">Uploaded Into</th>
                <th className="px-5 py-3">Already Exists In</th>
                <th className="px-5 py-3">Detected</th>
                {canDelete && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.email}</td>
                  <td className="px-5 py-3 text-slate-500">{r.fileName ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {r.newListName ?? '—'}
                    {r.newCompany ? <span className="block text-xs text-slate-400">{r.newCompany}</span> : null}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {r.existingListNames ?? '—'}
                    {r.existingCompany ? <span className="block text-xs text-slate-400">{r.existingCompany}</span> : null}
                  </td>
                  <td className="px-5 py-3 text-slate-400">{new Date(r.createdAt).toLocaleString()}</td>
                  {canDelete && (
                    <td className="px-5 py-3 text-right">
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => removeRow(r.id)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            {rows.length} duplicate{rows.length === 1 ? '' : 's'} shown{rows.length >= 2000 ? ' (capped — use search to narrow, or download the CSV for the full set)' : ''}.
          </div>
        </div>
      )}
    </div>
  );
}
