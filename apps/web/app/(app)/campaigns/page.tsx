'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, EmptyState } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  status: string;
  clientLabel?: string;
}
interface Named {
  id: string;
  name?: string;
  label?: string;
  emailAddress?: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [mailboxes, setMailboxes] = useState<Named[]>([]);
  const [lists, setLists] = useState<Named[]>([]);
  const [templates, setTemplates] = useState<Named[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    clientLabel: '',
    emailAccountId: '',
    listId: '',
    templateId: '',
  });
  const [error, setError] = useState('');

  function reload() {
    api.get<Campaign[]>('/campaigns').then(setCampaigns).catch(() => {});
  }

  useEffect(() => {
    reload();
    api.get<Named[]>('/email-accounts').then(setMailboxes).catch(() => {});
    api.get<Named[]>('/contact-lists').then(setLists).catch(() => {});
    api.get<Named[]>('/templates').then(setTemplates).catch(() => {});
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/campaigns', {
        name: form.name,
        clientLabel: form.clientLabel || undefined,
        emailAccountId: form.emailAccountId || undefined,
        listId: form.listId || undefined,
        templateId: form.templateId || undefined,
      });
      setShowForm(false);
      setForm({ name: '', clientLabel: '', emailAccountId: '', listId: '', templateId: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Build, submit, and track outreach"
        action={
          <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New campaign'}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={create} className="card mb-6 space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Campaign name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Client label</label>
              <input
                className="input"
                value={form.clientLabel}
                onChange={(e) => setForm({ ...form, clientLabel: e.target.value })}
                placeholder="e.g. Acme Corp"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Select
              label="Mailbox"
              value={form.emailAccountId}
              onChange={(v) => setForm({ ...form, emailAccountId: v })}
              options={mailboxes.map((m) => ({ id: m.id, label: m.label ?? m.emailAddress ?? m.id }))}
            />
            <Select
              label="Contact list"
              value={form.listId}
              onChange={(v) => setForm({ ...form, listId: v })}
              options={lists.map((l) => ({ id: l.id, label: l.name ?? l.id }))}
            />
            <Select
              label="Template"
              value={form.templateId}
              onChange={(v) => setForm({ ...form, templateId: v })}
              options={templates.map((t) => ({ id: t.id, label: t.name ?? t.id }))}
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary">Create draft</button>
        </form>
      )}

      {campaigns.length === 0 ? (
        <EmptyState message="No campaigns yet. Create your first draft above." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-slate-500">{c.clientLabel ?? '—'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      Open
                    </Link>
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

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
