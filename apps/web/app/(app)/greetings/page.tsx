'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';

interface Greeting {
  id: string;
  message: string;
}

export default function GreetingsPage() {
  const [messages, setMessages] = useState<Greeting[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ enabled: boolean; messages: Greeting[] }>('/greetings')
      .then((r) => {
        setEnabled(r.enabled);
        setMessages(r.messages);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!msg.trim()) return;
    setBusy(true);
    try {
      await api.post('/greetings', { message: msg.trim() });
      setMsg('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this greeting message?')) return;
    try {
      await api.del(`/greetings/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      await api.patch('/greetings/settings', { enabled: next });
    } catch {
      setEnabled(!next); // revert on failure
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Client Greetings"
        subtitle="A time-based greeting + a rotating “Happy Business” message shown to each client once a day on login"
      />

      {/* On/off */}
      <div className="card mb-4 flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-semibold text-slate-800">Greeting service</div>
          <div className="text-xs text-slate-500">
            {enabled
              ? 'Clients see a greeting once per day when they open the portal.'
              : 'Greetings are turned off — clients will not see them.'}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {enabled ? 'On — Stop service' : 'Off — Start service'}
        </button>
      </div>

      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="New Happy Business message…"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      <div className="card divide-y divide-slate-100">
        {messages.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No messages yet.</div>
        ) : (
          messages.map((m, i) => (
            <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="text-sm text-slate-700">
                <span className="mr-2 text-slate-300">{i + 1}.</span>
                {m.message}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-slate-400 hover:text-rose-600"
                onClick={() => remove(m.id)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        The “Happy Business” line rotates one message per day, cycling through the list and
        repeating once all have been shown.
      </p>
    </div>
  );
}
