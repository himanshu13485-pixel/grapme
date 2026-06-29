'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  parseFile,
  parsePastedEmails,
  autoMap,
  buildContacts,
  FieldKey,
  ParsedRow,
  ContactRow,
} from '@/lib/parse-contacts';

interface List {
  id: string;
  name?: string;
}

const FIELD_OPTIONS: { value: FieldKey; label: string }[] = [
  { value: 'email', label: 'Email *' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'company', label: 'Company' },
  { value: 'country', label: 'Country' },
  { value: 'ignore', label: 'Ignore' },
];

export function ImportWizard({
  lists,
  clientId,
  onDone,
}: {
  lists: List[];
  clientId?: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [pasted, setPasted] = useState('');
  const [listId, setListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setError('');
    setFilename(file.name);
    try {
      const parsed = await parseFile(file);
      if (!parsed.headers.length) {
        setError('Could not read any columns from this file.');
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMap(parsed.headers));
    } catch {
      setError('Failed to parse file. Use a .csv or .xlsx export.');
    }
  }

  // Build the contact rows depending on the active source.
  const contacts: ContactRow[] =
    mode === 'paste'
      ? parsePastedEmails(pasted)
      : headers.length
        ? buildContacts(rows, mapping).contacts
        : [];

  const stats =
    mode === 'paste'
      ? { total: contacts.length, valid: contacts.length, invalid: 0, duplicates: 0 }
      : headers.length
        ? buildContacts(rows, mapping)
        : { total: 0, valid: 0, invalid: 0, duplicates: 0 };

  async function submit() {
    if (!contacts.length) {
      setError('Nothing to import — add a file or paste some emails.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let targetList = listId;
      if (newListName.trim()) {
        const created = await api.post<{ id: string }>('/contact-lists', {
          name: newListName.trim(),
          clientId: clientId || undefined,
        });
        targetList = created.id;
      }
      const res = await api.post<{
        validRows: number;
        dupRows: number;
        totalRows: number;
      }>('/contacts/import', {
        filename: filename || 'pasted-list.csv',
        listId: targetList || undefined,
        clientId: clientId || undefined,
        rows: contacts,
      });
      setResult(
        `Staged ${res.validRows} contacts (${res.dupRows} duplicates skipped). ` +
          `They’ll be added once an admin approves the import.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ {result}
        </div>
        <button className="btn-primary w-full" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Source toggle */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {(['file', 'paste'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              mode === m ? 'bg-white shadow-sm' : 'text-slate-500'
            }`}
          >
            {m === 'file' ? 'Upload CSV / Excel' : 'Paste emails'}
          </button>
        ))}
      </div>

      {mode === 'file' ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragOver
                ? 'border-brand-500 bg-brand-50'
                : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
            }`}
          >
            <div className="text-2xl">⭱</div>
            <p className="mt-2 text-sm font-medium text-slate-700">
              {filename || 'Drop a CSV / Excel file, or click to browse'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Accepts .csv, .xlsx — headers auto-detected
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>

          {/* Column mapping */}
          {headers.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700">
                Map columns
              </h4>
              <div className="space-y-2">
                {headers.map((h) => (
                  <div key={h} className="flex items-center gap-3">
                    <span className="w-1/2 truncate text-sm text-slate-600">
                      {h}
                    </span>
                    <select
                      className="input w-1/2 py-1.5"
                      value={mapping[h]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [h]: e.target.value as FieldKey })
                      }
                    >
                      {FIELD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <textarea
          className="input h-32 font-mono text-xs"
          placeholder="one@example.com, two@example.com&#10;three@example.com"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
      )}

      {/* Target list */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Add to list (optional)</label>
          <select
            className="input"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            disabled={Boolean(newListName)}
          >
            <option value="">No list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">…or create a new list</label>
          <input
            className="input"
            placeholder="New list name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
          />
        </div>
      </div>

      {/* Live preview / dedupe stats */}
      {stats.total > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Rows" value={stats.total} />
          <Stat label="Valid" value={stats.valid} tone="emerald" />
          <Stat label="Duplicates" value={stats.duplicates} tone="amber" />
          <Stat label="Invalid" value={stats.invalid} tone="rose" />
        </div>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        className="btn-primary w-full"
        onClick={submit}
        disabled={busy || stats.valid === 0}
      >
        {busy
          ? 'Staging…'
          : `Import ${stats.valid} contact${stats.valid === 1 ? '' : 's'} for approval`}
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose';
}) {
  const tones = {
    slate: 'text-slate-700',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
  };
  return (
    <div className="rounded-lg border border-slate-100 py-2">
      <div className={`text-xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}
