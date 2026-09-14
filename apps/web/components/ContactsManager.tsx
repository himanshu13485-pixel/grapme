'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
import { downloadCsv } from '@/lib/csv';
import {
  PageHeader,
  EmptyState,
  StatusBadge,
  Modal,
  Tabs,
  Pagination,
} from '@/components/ui';
import { ImportWizard } from '@/components/ImportWizard';

type PendingResult = { pendingApproval?: boolean; message?: string } | null | undefined;

/** Tell the user when the server held their change for review instead of applying it. */
function heldForApproval(r: PendingResult): boolean {
  if (!r?.pendingApproval) return false;
  alert(r.message ?? 'Sent for approval. Nothing changes until our team approves it.');
  return true;
}

interface ClientRef { id: string; name: string }
interface Contact {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  country?: string;
  status: string;
  listIds?: string[];
  clientId?: string;
  client?: ClientRef;
}
interface List {
  id: string;
  name: string;
  description?: string;
  _count?: { members: number };
  clientId?: string;
  client?: ClientRef;
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

export function ContactsManager({ clientId }: { clientId?: string }) {
  const canDelete = useCanDelete();
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 25;

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showList, setShowList] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [viewingList, setViewingList] = useState<List | null>(null);

  function loadAll() {
    const q = clientId ? `?clientId=${clientId}` : '';
    api.get<Contact[]>(`/contacts${q}`).then(setContacts).catch(() => {});
    api.get<List[]>(`/contact-lists${q}`).then(setLists).catch(() => {});
    api.get<ImportJob[]>('/contacts/imports').then(setImports).catch(() => {});
    if (!clientId) api.get<ClientRef[]>('/clients').then(setClients).catch(() => {});
  }
  useEffect(loadAll, [clientId]);

  async function deleteContact(c: Contact) {
    if (!confirm(`Delete ${c.email} permanently?`)) return;
    try {
      heldForApproval(await api.del<PendingResult>(`/contacts/${c.id}`));
      loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  }

  const toggleOne = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected contact${ids.length === 1 ? '' : 's'} permanently?`)) return;
    try {
      const r = await api.post<{ deleted?: number; pendingApproval?: boolean; message?: string }>('/contacts/delete', { ids });
      setSelected(new Set());
      loadAll();
      if (!heldForApproval(r)) {
        const n = r.deleted ?? 0;
        alert(`Deleted ${n} contact${n === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete contacts');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (clientFilter !== 'ALL') {
        if (clientFilter === 'NONE' ? c.clientId : c.clientId !== clientFilter)
          return false;
      }
      if (!q) return true;
      return [c.email, c.firstName, c.lastName, c.company]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [contacts, search, statusFilter, clientFilter]);

  useEffect(() => setPage(1), [search, statusFilter, clientFilter]);
  const pagedContacts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filteredLists = useMemo(() => {
    if (clientFilter === 'ALL') return lists;
    return lists.filter((l) =>
      clientFilter === 'NONE' ? !l.clientId : l.clientId === clientFilter,
    );
  }, [lists, clientFilter]);

  const actions = (
    <div className="flex gap-2">
      <button className="btn-ghost" onClick={() => setShowAdd(true)}>
        + Add contact
      </button>
      <button className="btn-primary" onClick={() => setShowImport(true)}>
        ⭱ Import CSV / Excel
      </button>
    </div>
  );

  return (
    <div>
      {clientId ? (
        <div className="mb-4 flex justify-end">{actions}</div>
      ) : (
        <PageHeader
          title="Contacts"
          subtitle="Build and manage your outreach audience"
          action={actions}
        />
      )}

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
            {!clientId && (
              <select
                className="input w-48"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                <option value="ALL">All clients</option>
                <option value="NONE">Unassigned</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name}</option>
                ))}
              </select>
            )}
            {canDelete && selected.size > 0 && (
              <button className="btn-ghost text-sm text-rose-600" onClick={bulkDelete}>
                🗑 Delete selected ({selected.size})
              </button>
            )}
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
                    {canDelete && (
                      <th className="px-5 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select page"
                          checked={pagedContacts.length > 0 && pagedContacts.every((c) => selected.has(c.id))}
                          onChange={() => setSelected((prev) => {
                            const n = new Set(prev);
                            const all = pagedContacts.every((c) => n.has(c.id));
                            pagedContacts.forEach((c) => (all ? n.delete(c.id) : n.add(c.id)));
                            return n;
                          })}
                        />
                      </th>
                    )}
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Company</th>
                    {!clientId && <th className="px-5 py-3">Client</th>}
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedContacts.map((c) => (
                    <tr key={c.id} className={`border-t border-slate-100 ${selected.has(c.id) ? 'bg-brand-50/40' : ''}`}>
                      {canDelete && (
                        <td className="px-5 py-3">
                          <input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                        </td>
                      )}
                      <td className="px-5 py-3 font-medium">{c.email}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{c.company ?? '—'}</td>
                      {!clientId && (
                        <td className="px-5 py-3 text-slate-500">{c.client?.name ?? '—'}</td>
                      )}
                      <td className="px-5 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => setEditing(c)}
                        >
                          Edit
                        </button>
                        {canDelete && (
                          <button
                            className="btn-ghost text-xs text-rose-600"
                            onClick={() => deleteContact(c)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </>
      )}

      {/* ── Lists tab ── */}
      {tab === 'lists' && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <button className="btn-primary" onClick={() => setShowList(true)}>
              + New list
            </button>
            {!clientId && (
              <select
                className="input w-48"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                <option value="ALL">All clients</option>
                <option value="NONE">Unassigned</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name}</option>
                ))}
              </select>
            )}
          </div>
          {filteredLists.length === 0 ? (
            <EmptyState message="No lists match. Create one to group contacts for a cohort." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredLists.map((l) => (
                <button
                  key={l.id}
                  className="card p-5 text-left transition hover:border-brand-300 hover:shadow-sm"
                  onClick={() => setViewingList(l)}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{l.name}</div>
                    {l.client?.name && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                        {l.client.name}
                      </span>
                    )}
                  </div>
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
                  <div className="mt-2 text-xs text-brand-600">
                    Manage members →
                  </div>
                </button>
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
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add contact" disableBackdropClose>
        <AddContactForm
          lists={lists}
          clients={clients}
          lockedClientId={clientId}
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
        disableBackdropClose
      >
        <ImportWizard
          lists={lists}
          clientId={clientId}
          onDone={() => {
            setShowImport(false);
            loadAll();
          }}
        />
      </Modal>

      <Modal open={showList} onClose={() => setShowList(false)} title="New list" disableBackdropClose>
        <NewListForm
          clients={clients}
          lockedClientId={clientId}
          onDone={() => {
            setShowList(false);
            loadAll();
          }}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit contact"
        disableBackdropClose
      >
        {editing && (
          <EditContactForm
            contact={editing}
            lists={lists}
            clients={clients}
            lockedClientId={clientId}
            onDone={() => {
              setEditing(null);
              loadAll();
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!viewingList}
        onClose={() => setViewingList(null)}
        title={viewingList ? `List · ${viewingList.name}` : 'List'}
        wide
      >
        {viewingList && (
          <ListDetail
            list={viewingList}
            allContacts={contacts}
            onChanged={loadAll}
            onDeleted={() => {
              setViewingList(null);
              loadAll();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function AddContactForm({
  lists,
  clients,
  lockedClientId,
  onDone,
}: {
  lists: List[];
  clients: ClientRef[];
  lockedClientId?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    company: '',
    country: '',
    listId: '',
    clientId: lockedClientId ?? '',
  });
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.post<PendingResult>('/contacts', {
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        company: form.company || undefined,
        country: form.country || undefined,
        listId: form.listId || undefined,
        clientId: form.clientId || undefined,
      });
      heldForApproval(r);
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
      <div className="grid grid-cols-2 gap-3">
        {!lockedClientId && (
          <div>
            <label className="label">Client</label>
            <select
              className="input"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {clients.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Add to list</label>
          <select
            className="input"
            value={form.listId}
            onChange={(e) => setForm({ ...form, listId: e.target.value })}
          >
            <option value="">No list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full">Add contact</button>
    </form>
  );
}

function NewListForm({
  clients,
  lockedClientId,
  onDone,
}: {
  clients: ClientRef[];
  lockedClientId?: string;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState(lockedClientId ?? '');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.post<PendingResult>('/contact-lists', {
        name,
        description: description || undefined,
        clientId: clientId || undefined,
      });
      heldForApproval(r);
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
      {!lockedClientId && (
        <div>
          <label className="label">Client</label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {clients.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full">Create list</button>
    </form>
  );
}

function EditContactForm({
  contact,
  lists,
  clients,
  lockedClientId,
  onDone,
}: {
  contact: Contact;
  lists: List[];
  clients: ClientRef[];
  lockedClientId?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    email: contact.email,
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    company: contact.company ?? '',
    country: contact.country ?? '',
    status: contact.status,
    clientId: contact.clientId ?? lockedClientId ?? '',
  });
  const [listIds, setListIds] = useState<string[]>(contact.listIds ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggleList(id: string) {
    setListIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.patch<PendingResult>(`/contacts/${contact.id}`, {
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        company: form.company || undefined,
        country: form.country || undefined,
        status: form.status,
        clientId: form.clientId,
        listIds,
      });
      heldForApproval(r);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this contact permanently?')) return;
    setError('');
    setBusy(true);
    try {
      heldForApproval(await api.del<PendingResult>(`/contacts/${contact.id}`));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="ACTIVE">Active</option>
            <option value="UNSUBSCRIBED">Unsubscribed</option>
            <option value="BOUNCED">Bounced</option>
          </select>
        </div>
        {!lockedClientId && (
          <div>
            <label className="label">Client</label>
            <select
              className="input"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {clients.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="label">Lists</label>
        {lists.length === 0 ? (
          <p className="text-xs text-slate-400">
            No lists yet — create one in the Lists tab.
          </p>
        ) : (
          <div className="space-y-1 rounded-lg border border-slate-200 p-3">
            {lists.map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={listIds.includes(l.id)}
                  onChange={() => toggleList(l.id)}
                />
                {l.name}
              </label>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost text-rose-600"
          onClick={remove}
          disabled={busy}
        >
          Delete
        </button>
        <button className="btn-primary flex-1" disabled={busy}>
          Save changes
        </button>
      </div>
    </form>
  );
}

function contactName(c: Contact) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}

function ListDetail({
  list,
  allContacts,
  onChanged,
  onDeleted,
}: {
  list: List;
  allContacts: Contact[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const canDelete = useCanDelete();
  const [members, setMembers] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // members to remove
  const [toAdd, setToAdd] = useState<string[]>([]); // contacts to add
  const [addSearch, setAddSearch] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ members: { contact: Contact }[] }>(`/contact-lists/${list.id}`)
      .then((d) => setMembers(d.members.map((m) => m.contact)))
      .catch(() => {});
  }
  useEffect(load, [list.id]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const candidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return allContacts
      .filter((c) => !memberIds.has(c.id))
      .filter((c) =>
        !q
          ? true
          : [c.email, c.firstName, c.lastName, c.company]
              .filter(Boolean)
              .some((v) => v!.toLowerCase().includes(q)),
      );
  }, [allContacts, memberIds, addSearch]);

  function toggle(set: string[], setSet: (v: string[]) => void, id: string) {
    setSet(set.includes(id) ? set.filter((x) => x !== id) : [...set, id]);
  }

  async function addSelected() {
    if (toAdd.length === 0) return;
    setBusy(true);
    try {
      heldForApproval(await api.post<PendingResult>(`/contact-lists/${list.id}/members`, { contactIds: toAdd }));
      setToAdd([]);
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      heldForApproval(
        await api.post<PendingResult>(`/contact-lists/${list.id}/members/remove`, {
          contactIds: ids,
        }),
      );
      setSelected((prev) => prev.filter((x) => !ids.includes(x)));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deleteList() {
    if (
      !confirm(
        `Delete the list "${list.name}"? Contacts stay, but the list and its membership are removed.`,
      )
    )
      return;
    setBusy(true);
    try {
      heldForApproval(await api.del<PendingResult>(`/contact-lists/${list.id}`));
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete list');
      setBusy(false);
    }
  }

  async function cleanList() {
    if (
      !confirm(
        `Remove all suppressed contacts (bounced / unsubscribed) from "${list.name}"? The contacts are kept — only their membership in this list is removed.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api.post<{ removed: number }>(`/contact-lists/${list.id}/clean`);
      alert(
        r.removed > 0
          ? `Removed ${r.removed} suppressed contact(s) from the list.`
          : 'No suppressed contacts in this list.',
      );
      load();
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clean list');
    } finally {
      setBusy(false);
    }
  }

  function exportList() {
    const headers = ['Email', 'First name', 'Last name', 'Company', 'Country', 'Status'];
    const rows = members.map((c) => [
      c.email,
      c.firstName ?? '',
      c.lastName ?? '',
      c.company ?? '',
      c.country ?? '',
      c.status,
    ]);
    const safe = list.name.replace(/[^\w-]+/g, '_');
    downloadCsv(`${safe}_contacts`, headers, rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="text-sm text-slate-500">
          {list.description || 'Manage this list’s members below.'}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={exportList}
            disabled={members.length === 0}
            title="Download current members as CSV"
          >
            ⭳ Export CSV
          </button>
          {canDelete && (
            <>
              <button
                className="btn-ghost text-xs text-amber-600"
                onClick={cleanList}
                disabled={busy}
                title="Remove bounced/unsubscribed contacts from this list"
              >
                🧹 Clean list
              </button>
              <button
                className="btn-ghost text-xs text-rose-600"
                onClick={deleteList}
                disabled={busy}
              >
                Delete list
              </button>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Members */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Members ({members.length})
          </h3>
          {selected.length > 0 && (
            <button
              className="btn-ghost text-xs text-rose-600"
              onClick={() => removeSelected(selected)}
              disabled={busy}
            >
              Remove selected ({selected.length})
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <EmptyState message="No contacts in this list yet. Add some from the right." />
        ) : (
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            {members.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(selected, setSelected, c.id)}
                />
                <span className="flex-1">
                  <span className="font-medium">{c.email}</span>
                  <span className="ml-2 text-slate-400">{contactName(c)}</span>
                </span>
                <button
                  className="text-xs text-rose-500 hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    removeSelected([c.id]);
                  }}
                  disabled={busy}
                >
                  Remove
                </button>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Add contacts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Add contacts</h3>
          {toAdd.length > 0 && (
            <button
              className="btn-primary text-xs"
              onClick={addSelected}
              disabled={busy}
            >
              Add selected ({toAdd.length})
            </button>
          )}
        </div>
        <input
          className="input mb-2"
          placeholder="Search contacts to add…"
          value={addSearch}
          onChange={(e) => setAddSearch(e.target.value)}
        />
        {candidates.length === 0 ? (
          <EmptyState message="No more contacts to add." />
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
            {candidates.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={toAdd.includes(c.id)}
                  onChange={() => toggle(toAdd, setToAdd, c.id)}
                />
                <span className="flex-1">
                  <span className="font-medium">{c.email}</span>
                  <span className="ml-2 text-slate-400">{contactName(c)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
