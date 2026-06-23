'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Contact {
  id: string;
  email: string;
  firstName?: string;
  company?: string;
  status: string;
}
interface List {
  id: string;
  name: string;
  _count?: { members: number };
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [form, setForm] = useState({ email: '', firstName: '', company: '' });
  const [listName, setListName] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
    api.get<List[]>('/contact-lists').then(setLists).catch(() => {});
  }
  useEffect(load, []);

  async function addContact(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/contacts', {
        email: form.email,
        firstName: form.firstName || undefined,
        company: form.company || undefined,
      });
      setForm({ email: '', firstName: '', company: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function addList(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/contact-lists', { name: listName });
      setListName('');
      load();
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <PageHeader title="Contacts" subtitle="Manage your audience" />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={addContact} className="card space-y-3 p-5 lg:col-span-2">
          <h3 className="font-medium">Add contact</h3>
          <div className="grid grid-cols-3 gap-3">
            <input
              className="input"
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="First name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Company"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary">Add</button>
        </form>

        <form onSubmit={addList} className="card space-y-3 p-5">
          <h3 className="font-medium">New list</h3>
          <input
            className="input"
            placeholder="List name"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            required
          />
          <button className="btn-ghost w-full">Create list</button>
          <div className="space-y-1 pt-2">
            {lists.map((l) => (
              <div
                key={l.id}
                className="flex justify-between text-sm text-slate-600"
              >
                <span>{l.name}</span>
                <span className="text-slate-400">
                  {l._count?.members ?? 0}
                </span>
              </div>
            ))}
          </div>
        </form>
      </div>

      {contacts.length === 0 ? (
        <EmptyState message="No contacts yet. Add one above or import a CSV via the API." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{c.email}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {c.firstName ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {c.company ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
