'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
import { PageHeader, StatusBadge, EmptyState, Pagination } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  status: string;
  clientLabel?: string;
  startAt?: string | null;
  client?: { id: string; name: string };
}
interface Named {
  id: string;
  name?: string;
  label?: string;
  emailAddress?: string;
}

/**
 * Campaign manager. Standalone on /campaigns, or scoped to one client inside
 * the Clients Workspace — listing only that client's campaigns, allocating new
 * ones to it, and picking from that client's own mailboxes/lists/templates.
 */
export function CampaignsManager({ clientId }: { clientId?: string }) {
  const canDelete = useCanDelete();
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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const paged = campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const scope = clientId ? `?clientId=${clientId}` : '';

  function reload() {
    api.get<Campaign[]>(`/campaigns${scope}`).then(setCampaigns).catch(() => {});
  }

  useEffect(() => {
    reload();
    api.get<Named[]>(`/email-accounts${scope}`).then(setMailboxes).catch(() => {});
    api.get<Named[]>(`/contact-lists${scope}`).then(setLists).catch(() => {});
    api.get<Named[]>(`/templates${scope}`).then(setTemplates).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/campaigns', {
        name: form.name,
        clientLabel: form.clientLabel || undefined,
        clientId: clientId || undefined,
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

  async function lifecycle(id: string, action: 'pause' | 'resume' | 'stop') {
    if (action === 'stop' && !confirm('Stop this campaign? Pending sends are dropped.')) return;
    try {
      await api.post(`/campaigns/${id}/${action}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (
      !confirm(
        `Delete the campaign "${c.name}" permanently? Its steps, recipients and sent-message records are removed.`,
      )
    )
      return;
    try {
      await api.del(`/campaigns/${c.id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  }

  const fmtStart = (s?: string | null) =>
    s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const toggleBtn = (
    <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
      {showForm ? 'Cancel' : '+ New campaign'}
    </button>
  );

  return (
    <div>
      {clientId ? (
        <div className="mb-4">{toggleBtn}</div>
      ) : (
        <PageHeader
          title="Campaigns"
          subtitle="Build, submit, and track outreach"
          action={toggleBtn}
        />
      )}

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
            {!clientId && (
              <div>
                <label className="label">Client label</label>
                <input
                  className="input"
                  value={form.clientLabel}
                  onChange={(e) => setForm({ ...form, clientLabel: e.target.value })}
                  placeholder="e.g. Acme Corp"
                />
              </div>
            )}
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
        <>
        <div className="mb-3 text-sm text-slate-400">{campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}</div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Name</th>
                {!clientId && <th className="px-5 py-3">Client</th>}
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Start</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  {!clientId && (
                    <td className="px-5 py-3 text-slate-500">
                      {c.client?.name ?? c.clientLabel ?? '—'}
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-400">{fmtStart(c.startAt)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {c.status === 'RUNNING' && (
                      <button className="btn-ghost text-xs" onClick={() => lifecycle(c.id, 'pause')}>Pause</button>
                    )}
                    {c.status === 'PAUSED' && (
                      <button className="btn-ghost text-xs text-emerald-600" onClick={() => lifecycle(c.id, 'resume')}>Resume</button>
                    )}
                    {['RUNNING', 'PAUSED', 'SCHEDULED'].includes(c.status) && (
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => lifecycle(c.id, 'stop')}>Stop</button>
                    )}
                    <Link href={`/campaigns/${c.id}`} className="ml-1 text-brand-600 hover:underline">
                      Open
                    </Link>
                    {canDelete && (
                      <button
                        className="btn-ghost text-xs text-rose-600"
                        onClick={() => deleteCampaign(c)}
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={campaigns.length} onPage={setPage} />
        </>
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
