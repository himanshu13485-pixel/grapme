'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type MessagingChannel = 'whatsapp' | 'telegram';

interface VerifyStatus {
  channel: MessagingChannel;
  label: string;
  phone: string | null;
  verified: boolean;
  verifiedAt: string | null;
  notify: boolean;
  cooldown: number;
  configured: boolean;
}

/** Only what genuinely reads differently between the two networks. */
const COPY: Record<MessagingChannel, { where: string; hint: string }> = {
  whatsapp: {
    where: 'on WhatsApp',
    hint: 'The code arrives as a WhatsApp message.',
  },
  telegram: {
    where: 'on Telegram',
    hint: 'The code arrives in the Telegram app on that number. If you are not on Telegram, or have "find me by phone number" switched off, it cannot reach you.',
  },
};

/**
 * Verify-your-number card for one messaging channel.
 *
 * Optional by design: skipping it just means we never send alerts there. Each
 * network is proved separately — the same number reaching you on WhatsApp is no
 * evidence it reaches you on Telegram, and on Telegram it may not be reachable
 * at all depending on that person's privacy settings.
 */
export default function ChannelVerify({
  channel,
  onVerified,
}: {
  channel: MessagingChannel;
  onVerified?: () => void;
}) {
  const [status, setStatus] = useState<VerifyStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const base = `/channel-verify/${channel}`;
  const copy = COPY[channel];

  const load = useCallback(async () => {
    try {
      const s = await api.get<VerifyStatus>(base);
      setStatus(s);
      setCooldown(s.cooldown ?? 0);
    } catch {
      /* leave the card hidden if we can't read status */
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await api.post<{ ok: boolean; error?: string; retryAfter?: number }>(`${base}/send`, {});
      if (res.ok) {
        setSent(true);
        setMsg(`We sent a 6-digit code to ${status?.phone} ${copy.where}.`);
        setCooldown(60);
      } else {
        setErr(res.error ?? 'Could not send the code.');
        if (res.retryAfter) setCooldown(res.retryAfter);
      }
    } catch {
      setErr('Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!code.trim()) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(base, { code: code.trim() });
      if (res.ok) {
        setCode('');
        setSent(false);
        setMsg(`Your number is verified for ${status?.label ?? channel}.`);
        await load();
        onVerified?.();
      } else {
        setErr(res.error ?? 'That code is not correct.');
      }
    } catch {
      setErr('Could not check the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show until we know the state, or if this channel isn't set up.
  if (!status || !status.configured) return null;

  // No number on file — verification isn't possible yet.
  if (!status.phone) {
    return <p className="text-xs text-slate-500">Add a mobile number above to receive alerts {copy.where}.</p>;
  }

  if (status.verified) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <span aria-hidden>✓</span>
        <span>
          <strong>{status.phone}</strong> is verified for {status.label}
          {status.verifiedAt ? ` — ${new Date(status.verifiedAt).toLocaleDateString()}` : ''}.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">Verify your number for {status.label}</p>
      <p className="mt-0.5 text-xs text-amber-800">
        We only send alerts to a number you&apos;ve confirmed is yours. Sending to <strong>{status.phone}</strong>.{' '}
        {copy.hint}
      </p>

      {msg && <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</p>}

      {!sent ? (
        <button type="button" className="btn-primary mt-3" disabled={busy || cooldown > 0} onClick={sendCode}>
          {busy ? 'Sending…' : cooldown > 0 ? `Send a code (${cooldown}s)` : `Send me a code ${copy.where}`}
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="input w-36 text-center tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submitCode()}
          />
          <button type="button" className="btn-primary" disabled={busy || code.length < 6} onClick={submitCode}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            type="button"
            className="text-xs text-slate-500 underline disabled:opacity-50"
            disabled={busy || cooldown > 0}
            onClick={sendCode}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      )}
    </div>
  );
}
