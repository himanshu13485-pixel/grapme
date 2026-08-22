'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type MessagingChannel = 'whatsapp' | 'telegram';

export interface ChannelSettings {
  channel: MessagingChannel;
  label: string;
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
  channel?: string;
  bridge?: { status?: string; connected?: boolean; me?: string | null; lastError?: string | null };
  error?: string;
}

/** The wording that genuinely differs between the two networks. */
const COPY: Record<MessagingChannel, { icon: string; account: string; link: string; notConnected: string }> = {
  whatsapp: {
    icon: '💬',
    account: 'WhatsApp number',
    link: 'scan the QR for this project',
    notConnected: 'Open the portal and scan the QR for this project.',
  },
  telegram: {
    icon: '✈️',
    account: 'Telegram account',
    link: 'link this project’s account',
    notConnected: 'Open the portal and link this project — it asks for a phone number and a login code.',
  },
};

/**
 * One messaging channel's portal credentials.
 *
 * The two networks are configured independently — separate portal projects,
 * separate numbers, separate keys — so a workspace can run either, both, or
 * neither. Everything except the wording is the same, which is why this is one
 * component rather than two pages that drift apart.
 */
export default function ChannelSettingsCard({ channel }: { channel: MessagingChannel }) {
  const [w, setW] = useState<ChannelSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [msg, setMsg] = useState('');

  const copy = COPY[channel];
  const base = `/notifications/channels/${channel}`;

  useEffect(() => {
    api.get<ChannelSettings>(base).then(setW).catch(() => {});
  }, [base]);

  const set = (patch: Partial<ChannelSettings>) => setW((prev) => (prev ? { ...prev, ...patch } : prev));

  async function save(extra: { clearApiKey?: boolean } = {}) {
    if (!w) return;
    setBusy(true);
    setMsg('');
    setTest(null);
    try {
      const r = await api.patch<ChannelSettings>(base, {
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
      setTest(await api.post<TestResult>(`${base}/test`, {}));
    } catch {
      setTest({ ok: false, error: 'Could not reach the API.' });
    } finally {
      setTesting(false);
    }
  }

  if (!w) return null;

  const sourceLabel =
    w.source === 'workspace' ? 'this workspace’s settings' : w.source === 'env' ? 'the server .env fallback' : null;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {copy.icon}
        </span>
        <h3 className="font-semibold text-slate-800">{w.label}</h3>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            w.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${w.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {w.active ? 'Active' : 'Off'}
        </span>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Enable {w.label} notifications
      </label>
      <p className="mt-1 text-xs text-slate-500">
        Messages send from the {copy.account} linked to your project in the portal. Each person still has to verify their
        own number for {w.label} under My Account before we message them there.
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
            Just the address — no path. The same portal serves both networks; only the API key differs.
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
            placeholder={w.apiKeyHint ? `Saved (${w.apiKeyHint}) — leave blank to keep it` : `Paste the ${w.label} project’s API key`}
          />
          <p className="mt-1 text-xs text-slate-400">
            From the portal: the {w.label} project’s card → <strong>Integration details</strong>. Stored encrypted and
            never shown again.
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

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${w.active ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          <span className="text-slate-600">
            {w.active ? (
              <>
                Sending is active, using {sourceLabel}.
                {w.source === 'env' && !w.workspaceConfigured && (
                  <> Save a portal URL and API key above to use this workspace’s own account instead.</>
                )}
              </>
            ) : w.workspaceConfigured && !w.enabled ? (
              <>Turned off. Tick “Enable {w.label} notifications” above to start sending.</>
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
                    <>
                      The {copy.account} is online{test.bridge.me ? ` (${test.bridge.me})` : ''}.
                    </>
                  ) : (
                    <>
                      The key works, but the {copy.account} is not connected (status: {test.bridge?.status ?? 'unknown'}
                      ). {copy.notConnected}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="font-medium">{test.error ?? 'Test failed.'}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
