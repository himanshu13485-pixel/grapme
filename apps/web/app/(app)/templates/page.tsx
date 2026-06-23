'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  subject: string;
  variables: string[];
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({
    name: '',
    subject: 'Quick question, {{first_name}}',
    bodyHtml: '<p>Hi {{first_name}},</p><p>I noticed {{company}} and wanted to reach out.</p><p>Best,<br/>The team</p>',
  });
  const [error, setError] = useState('');

  function load() {
    api.get<Template[]>('/templates').then(setTemplates).catch(() => {});
  }
  useEffect(load, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/templates', form);
      setForm({ ...form, name: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Email templates"
        subtitle="Personalize with {{first_name}}, {{company}}, {{country}}"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-4 p-6">
          <h3 className="font-medium">New template</h3>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Body (HTML)</label>
            <textarea
              className="input h-40 font-mono text-xs"
              value={form.bodyHtml}
              onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })}
              required
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary">Save template</button>
        </form>

        <div>
          {templates.length === 0 ? (
            <EmptyState message="No templates yet." />
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t.id} className="card p-4">
                  <div className="font-medium">{t.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{t.subject}</div>
                  {t.variables?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.variables.map((v) => (
                        <span
                          key={v}
                          className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
