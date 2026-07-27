'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface VerifyStatus {
  phone: string | null;
  verified: boolean;
  verifiedAt: string | null;
  notifyWhatsapp: boolean;
  cooldown: number;
  configured: boolean;
}

/**
 * Verify-your-WhatsApp-number card.
 *
 * Optional by design: skipping it just means we never send WhatsApp alerts.
 * Sits under the notification preferences so the toggle and the proof live together.
 */
export default function WhatsappVerify({ onVerified }: { onVerified?: () => void }) {
  const [status, setStatus] = useState<VerifyStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const load = useCallback(async () => {
    try {
      const s = await api.get<VerifyStatus>('/whatsapp-verify');
      setStatus(s);
      setCooldown(s.cooldown ?? 0);
    } catch {
      /* leave the card hidden if we can't read status */
    }
  }, []);

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
      const res = await api.post<{ ok: boolean; error?: string; retryAfter?: number }>('/whatsapp-verify/send', {});
      if (res.ok) {
        setSent(true);
        setMsg(`We sent a 6-digit code to ${status?.phone} on WhatsApp.`);
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
      const res = await api.post<{ ok: boolean; error?: string }>('/whatsapp-verify', { code: code.trim() });
      if (res.ok) {
        setCode('');
        setSent(false);
        setMsg('Your WhatsApp number is verified.');
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

  // Nothing to show until we know the state, or if WhatsApp isn't set up at all.
  if (!status || !status.configured) return null;

  // No number on file — verification isn't possible yet.
  if (!status.phone) {
    return (
      <p className="text-xs text-slate-500">
        Add a WhatsApp number above to receive alerts there.
      </p>
    );
  }

  if (status.verified) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <span aria-hidden>✓</span>
        <span>
          <strong>{status.phone}</strong> is verified
          {status.verifiedAt ? ` — ${new Date(status.verifiedAt).toLocaleDateString()}` : ''}.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">Verify your WhatsApp number</p>
      <p className="mt-0.5 text-xs text-amber-800">
        We only send alerts to a number you&apos;ve confirmed is yours. Sending to{' '}
        <strong>{status.phone}</strong>.
      </p>

      {msg && <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</p>}

      {!sent ? (
        <button type="button" className="btn-primary mt-3" disabled={busy || cooldown > 0} onClick={sendCode}>
          {busy ? 'Sending…' : cooldown > 0 ? `Send a code (${cooldown}s)` : 'Send me a code on WhatsApp'}
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
