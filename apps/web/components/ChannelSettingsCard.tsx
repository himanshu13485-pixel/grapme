'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type MessagingChannel = 'whatsapp' | 'telegram' | 'netvork';

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

interface ChannelCopy {
  icon: string;
  account: string;
  link: string;
  notConnected: string;
  /** What the two credential fields are called on this network. */
  urlLabel: string;
  urlHint: string;
  keyLabel: string;
  keyHint: string;
  /** Where messages appear to come from. */
  sends: string;
}

/** The wording that genuinely differs between the networks. */
const COPY: Record<MessagingChannel, ChannelCopy> = {
  whatsapp: {
    icon: '💬',
    account: 'WhatsApp number',
    link: 'scan the QR for this project',
    notConnected: 'Open the portal and scan the QR for this project.',
    urlLabel: 'Portal URL',
    urlHint: 'Just the address — no path. The same portal serves both phone networks; only the API key differs.',
    keyLabel: 'API key',
    keyHint: 'From the portal: this project’s card → Integration details.',
    sends: 'Messages send from the WhatsApp number linked to your project in the portal.',
  },
  telegram: {
    icon: '✈️',
    account: 'Telegram account',
    link: 'link this project’s account',
    notConnected: 'Open the portal and link this project — it asks for a phone number and a login code.',
    urlLabel: 'Portal URL',
    urlHint: 'Just the address — no path. The same portal serves both phone networks; only the API key differs.',
    keyLabel: 'API key',
    keyHint: 'From the portal: this project’s card → Integration details.',
    sends: 'Messages send from the Telegram account linked to your project in the portal.',
  },
  /*
   * Netvork has no portal and no QR to scan. It is our own app, and we reach
   * people on it by being a user of it — so what is stored is the address of
   * the Netvork install and a login token for the account that will appear as
   * the sender. Same two fields, different things to put in them.
   */
  netvork: {
    icon: '🔵',
    account: 'Netvork account',
    link: 'sign in as the sending account',
    notConnected: 'Sign in to Netvork as the account that should send these alerts and issue a token for it.',
    urlLabel: 'Netvork URL',
    urlHint: 'Just the address — no path. For the hosted install that is https://netvork.app.',
    keyLabel: 'Account token',
    keyHint:
      'A Netvork API token for the account these alerts should come from. Everyone you alert has to be connected to that account on Netvork — Netvork only lets people message their connections by default.',
    sends: 'Messages send as direct messages from the Netvork account this token belongs to.',
  },
};

/**
 * One messaging channel's sending credentials.
 *
 * Every network is configured independently — its own account, its own key —
 * so a workspace can run any of them, all of them, or none. What is behind the
 * two fields differs (a portal project for the phone networks, a Netvork
 * account for Netvork) but their shape does not, which is why this is one
 * component rather than three pages that drift apart.
 */
export default function ChannelSettingsCard({ channel }: { channel: MessagingChannel }) {
  const [w, setW] = useState<ChannelSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ ok: boolean; sentTo?: string; error?: string } | null>(null);
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

  /**
   * The check that proves what the other one only implies.
   *
   * Test connection proves we can reach the service. It says nothing about
   * whether a message reaches a person, and everything between those two —
   * the address being right, the network accepting it, the phone lighting up —
   * is where this has actually gone wrong before. Sends to the admin who asked
   * and nobody else: a button that sends to somebody else is a button that
   * eventually sends to everybody.
   */
  async function sendTestMessage() {
    setSending(true);
    setSent(null);
    try {
      setSent(await api.post<{ ok: boolean; sentTo?: string; error?: string }>(`${base}/test-message`, {}));
    } catch {
      setSent({ ok: false, error: 'Could not send the test message.' });
    } finally {
      setSending(false);
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
        {copy.sends} Each person still has to verify their
        own number for {w.label} under My Account before we message them there.
      </p>

      <div className="mt-4 grid gap-4">
        <div>
          <label className="label">{copy.urlLabel}</label>
          <input
            className="input"
            value={w.portalUrl}
            onChange={(e) => set({ portalUrl: e.target.value })}
            placeholder="https://wa.yourdomain.com"
          />
          <p className="mt-1 text-xs text-slate-400">
            {copy.urlHint}
          </p>
        </div>

        <div>
          <label className="label">{copy.keyLabel}</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              w.apiKeyHint
                ? `Saved (${w.apiKeyHint}) — leave blank to keep it`
                : `Paste the ${w.label} ${copy.keyLabel.toLowerCase()}`
            }
          />
          <p className="mt-1 text-xs text-slate-400">
            {copy.keyHint} Stored encrypted and
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
        <button
          className="btn-ghost disabled:opacity-50"
          disabled={sending || !w.active}
          title="Sends a real message to you on this channel"
          onClick={sendTestMessage}
        >
          {sending ? 'Sending…' : 'Send me a test message'}
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
                  <> Save a {copy.urlLabel.toLowerCase()} and {copy.keyLabel.toLowerCase()} above to use this workspace’s own account instead.</>
                )}
              </>
            ) : w.workspaceConfigured && !w.enabled ? (
              <>Turned off. Tick “Enable {w.label} notifications” above to start sending.</>
            ) : (
              <>
                Not set up. Add the {copy.urlLabel.toLowerCase()} and {copy.keyLabel.toLowerCase()} above
                {w.envConfigured ? ', or leave them blank to use the server’s fallback credentials.' : '.'}
              </>
            )}
          </span>
        </div>

        {sent && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${sent.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {sent.ok
              ? `Sent to ${sent.sentTo}. If it does not arrive, the problem is between the network and the device — not the setup.`
              : sent.error}
          </div>
        )}

        {test && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {test.ok ? (
              <>
                <div className="font-medium">Connected to “{test.project ?? 'unknown'}”.</div>
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
