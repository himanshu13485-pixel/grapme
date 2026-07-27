'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, EmptyState } from '@/components/ui';

interface Wa {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  apiKeyHint: string;
  workspaceConfigured: boolean;
  envConfigured: boolean;
  active: boolean;
  source: 'workspace' | 'env' | 'none';
}

interface TestResult {
  ok: boolean;
  project?: string;
  bridge?: { status?: string; connected?: boolean; me?: { id?: string; name?: string } | null; lastError?: string | null };
  error?: string;
}

export default function WhatsappSettingsPage() {
  const [w, setW] = useState<Wa | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<Wa>('/notifications/whatsapp').then(setW).catch(() => {});
  }, []);

  const set = (patch: Partial<Wa>) => setW((prev) => (prev ? { ...prev, ...patch } : prev));

  async function save(extra: { clearApiKey?: boolean } = {}) {
    if (!w) return;
    setBusy(true);
    setMsg('');
    setTest(null);
    try {
      const r = await api.patch<Wa>('/notifications/whatsapp', {
        enabled: w.enabled,
        portalUrl: w.portalUrl,
        businessName: w.businessName,
        note: w.note,
        // Blank means "keep the saved key" — the key is never sent back to us.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...extra,
      });
      setW(r);
      setApiKey('');
      setMsg('Saved');
      setTimeout(() => setMsg(''), 1500);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestResult>('/notifications/whatsapp/test', {}));
    } catch {
      setTest({ ok: false, error: 'Could not reach the API.' });
    } finally {
      setTesting(false);
    }
  }

  if (!w) return <EmptyState message="Loading…" />;

  const sourceLabel =
    w.source === 'workspace' ? 'this workspace’s settings' : w.source === 'env' ? 'the server .env fallback' : null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="WhatsApp notifications"
        subtitle="Connect this workspace to the WhatsApp portal so alerts and number verification can send."
      />

      <div className="card p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enable WhatsApp notifications
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Messages send from the WhatsApp number paired to your project in the portal. Each person still has to verify
          their own number under My Account before we message them.
        </p>

        <div className="mt-4 grid gap-4">
          <div>
            <label className="label">Portal URL</label>
            <input
              className="input"
              value={w.portalUrl}
              onChange={(e) => set({ portalUrl: e.target.value })}
              placeholder="https://wa.yourdomain.com"
            />
            <p className="mt-1 text-xs text-slate-400">
              Just the address — no path. Paste the portal’s home URL, not the inbound webhook.
            </p>
          </div>

          <div>
            <label className="label">API key</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={w.apiKeyHint ? `Saved (${w.apiKeyHint}) — leave blank to keep it` : 'Paste the project’s API key'}
            />
            <p className="mt-1 text-xs text-slate-400">
              From the portal: your project card → <strong>Integration details</strong>. Stored encrypted and never shown
              again.
              {w.apiKeyHint && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text-rose-600 underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => save({ clearApiKey: true })}
                  >
                    Remove saved key
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Business / display name</label>
              <input
                className="input"
                value={w.businessName}
                onChange={(e) => set({ businessName: e.target.value })}
                placeholder="GrapMe"
              />
              <p className="mt-1 text-xs text-slate-400">Shown in the verification code message.</p>
            </div>
            <div>
              <label className="label">Note (internal)</label>
              <input
                className="input"
                value={w.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="e.g. which number this project uses"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={() => save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-ghost disabled:opacity-50" disabled={testing || !w.active} onClick={runTest}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="mb-2 font-semibold text-slate-800">Status</h3>
        <div className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${w.active ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          <span className="text-slate-600">
            {w.active ? (
              <>
                Sending is active, using {sourceLabel}.
                {w.source === 'env' && !w.workspaceConfigured && (
                  <> Save a portal URL and API key above to use this workspace’s own number instead.</>
                )}
              </>
            ) : w.workspaceConfigured && !w.enabled ? (
              <>Turned off. Tick “Enable WhatsApp notifications” above to start sending.</>
            ) : (
              <>
                Not set up. Add the portal URL and API key above
                {w.envConfigured ? ', or leave them blank to use the server’s fallback credentials.' : '.'}
              </>
            )}
          </span>
        </div>

        {test && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {test.ok ? (
              <>
                <div className="font-medium">Connected to project “{test.project ?? 'unknown'}”.</div>
                <div className="mt-1 text-xs">
                  {test.bridge?.connected ? (
                    <>WhatsApp number is online{test.bridge.me?.name ? ` (${test.bridge.me.name})` : ''}.</>
                  ) : (
                    <>
                      The key works, but the WhatsApp number is not connected (status: {test.bridge?.status ?? 'unknown'}
                      ). Open the portal and scan the QR for this project.
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="font-medium">{test.error ?? 'Test failed.'}</div>
            )}
          </div>
        )}

        <p className="mt-3 text-xs text-slate-400">
          The portal holds one WhatsApp number per project and queues sending, so alerts never block the action that
          triggered them.
        </p>
      </div>
    </div>
  );
}
