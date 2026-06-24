'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import {
  PageHeader,
  EmptyState,
  StatusBadge,
  Modal,
  Tabs,
} from '@/components/ui';
import { ImportWizard } from '@/components/ImportWizard';

interface Contact {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  country?: string;
  status: string;
}
interface List {
  id: string;
  name: string;
  description?: string;
  _count?: { members: number };
}
interface ImportJob {
  id: string;
  filename: string;
  totalRows: number;
  validRows: number;
  dupRows: number;
  status: string;
  createdAt: string;
}

export default function ContactsPage() {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showList, setShowList] = useState(false);

  function loadAll() {
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
    api.get<List[]>('/contact-lists').then(setLists).catch(() => {});
    api.get<ImportJob[]>('/contacts/imports').then(setImports).catch(() => {});
  }
  useEffect(loadAll, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.email, c.firstName, c.lastName, c.company]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [contacts, search, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Build and manage your outreach audience"
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setShowAdd(true)}>
              + Add contact
            </button>
            <button className="btn-primary" onClick={() => setShowImport(true)}>
              ⭱ Import CSV / Excel
            </button>
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'contacts', label: 'Contacts', count: contacts.length },
          { key: 'lists', label: 'Lists', count: lists.length },
          { key: 'imports', label: 'Import history', count: imports.length },
        ]}
      />

      {/* ── Contacts tab ── */}
      {tab === 'contacts' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              className="input max-w-xs"
              placeholder="Search email, name, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input w-44"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="UNSUBSCRIBED">Unsubscribed</option>
              <option value="BOUNCED">Bounced</option>
            </select>
            <span className="ml-auto text-sm text-slate-400">
              {filtered.length} of {contacts.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState message="No contacts match. Add one or import a CSV/Excel file." />
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Country</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-medium">{c.email}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{c.company ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{c.country ?? '—'}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Lists tab ── */}
      {tab === 'lists' && (
        <>
          <div className="mb-4">
            <button className="btn-primary" onClick={() => setShowList(true)}>
              + New list
            </button>
          </div>
          {lists.length === 0 ? (
            <EmptyState message="No lists yet. Create one to group contacts for a campaign." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lists.map((l) => (
                <div key={l.id} className="card p-5">
                  <div className="font-medium">{l.name}</div>
                  {l.description && (
                    <div className="mt-1 text-sm text-slate-500">
                      {l.description}
                    </div>
                  )}
                  <div className="mt-3 text-2xl font-semibold text-brand-700">
                    {l._count?.members ?? 0}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      contacts
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Import history tab ── */}
      {tab === 'imports' && (
        <>
          {imports.length === 0 ? (
            <EmptyState message="No imports yet. Use “Import CSV / Excel” above." />
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-5 py-3">File</th>
                    <th className="px-5 py-3">Rows</th>
                    <th className="px-5 py-3">Valid</th>
                    <th className="px-5 py-3">Dupes</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((j) => (
                    <tr key={j.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-medium">{j.filename}</td>
                      <td className="px-5 py-3 text-slate-500">{j.totalRows}</td>
                      <td className="px-5 py-3 text-slate-500">{j.validRows}</td>
                      <td className="px-5 py-3 text-slate-500">{j.dupRows}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-5 py-3 text-slate-400">
                        {new Date(j.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Imported contacts stay pending until an admin approves them in the
            Approvals queue.
          </p>
        </>
      )}

      {/* ── Modals ── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add contact">
        <AddContactForm
          onDone={() => {
            setShowAdd(false);
            loadAll();
          }}
        />
      </Modal>

      <Modal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import contacts"
        wide
      >
        <ImportWizard
          lists={lists}
          onDone={() => {
            setShowImport(false);
            loadAll();
          }}
        />
      </Modal>

      <Modal open={showList} onClose={() => setShowList(false)} title="New list">
        <NewListForm
          onDone={() => {
            setShowList(false);
            loadAll();
          }}
        />
      </Modal>
    </div>
  );
}

function AddContactForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    company: '',
    country: '',
  });
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/contacts', {
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        company: form.company || undefined,
        country: form.country || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Email *</label>
        <input
          type="email"
          className="input"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">First name</label>
          <input
            className="input"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Last name</label>
          <input
            className="input"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Company</label>
          <input
            className="input"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Country</label>
          <input
            className="input"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full">Add contact</button>
    </form>
  );
}

function NewListForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/contact-lists', {
        name,
        description: description || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">List name *</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label">Description</label>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full">Create list</button>
    </form>
  );
}
