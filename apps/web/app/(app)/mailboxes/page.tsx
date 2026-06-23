'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, EmptyState } from '@/components/ui';

interface Mailbox {
  id: string;
  label: string;
  emailAddress: string;
  protocol: string;
  status: string;
  dailyLimit: number;
}

export default function MailboxesPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    label: '',
    protocol: 'SMTP',
    emailAddress: '',
    password: '',
    smtpHost: '',
    smtpPort: 587,
    imapHost: '',
    imapPort: 993,
  });
  const [error, setError] = useState('');

  function load() {
    api.get<Mailbox[]>('/email-accounts').then(setMailboxes).catch(() => {});
  }
  useEffect(load, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/email-accounts', {
        ...form,
        smtpPort: Number(form.smtpPort),
        imapPort: Number(form.imapPort),
      });
      setShow(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function runTest(id: string) {
    setTest({ ...test, [id]: 'testing…' });
    try {
      const res = await api.post<{ reachable: boolean; detail: string }>(
        `/email-accounts/${id}/test`,
      );
      setTest({ ...test, [id]: res.detail });
    } catch (err) {
      setTest({ ...test, [id]: err instanceof Error ? err.message : 'Failed' });
    }
  }

  return (
    <div>
      <PageHeader
        title="Mailboxes"
        subtitle="Credentials are encrypted; new mailboxes need admin approval"
        action={
          <button className="btn-primary" onClick={() => setShow((s) => !s)}>
            {show ? 'Cancel' : '+ Add mailbox'}
          </button>
        }
      />

      {show && (
        <form onSubmit={create} className="card mb-6 space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Label</label>
              <input
                className="input"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Protocol</label>
              <select
                className="input"
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                <option>SMTP</option>
                <option>IMAP</option>
                <option>POP</option>
              </select>
            </div>
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                value={form.emailAddress}
                onChange={(e) =>
                  setForm({ ...form, emailAddress: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="label">Password / app-password</label>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">SMTP host</label>
              <input
                className="input"
                value={form.smtpHost}
                onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="label">SMTP port</label>
              <input
                type="number"
                className="input"
                value={form.smtpPort}
                onChange={(e) =>
                  setForm({ ...form, smtpPort: Number(e.target.value) })
                }
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary">Add mailbox</button>
        </form>
      )}

      {mailboxes.length === 0 ? (
        <EmptyState message="No mailboxes connected yet." />
      ) : (
        <div className="space-y-3">
          {mailboxes.map((m) => (
            <div
              key={m.id}
              className="card flex items-center justify-between p-5"
            >
              <div>
                <div className="font-medium">{m.label}</div>
                <div className="text-sm text-slate-500">
                  {m.emailAddress} · {m.protocol} · cap {m.dailyLimit}/day
                </div>
                {test[m.id] && (
                  <div className="mt-1 text-xs text-slate-400">{test[m.id]}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={m.status} />
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => runTest(m.id)}
                >
                  Test
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
