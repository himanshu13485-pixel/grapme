'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function ConfirmInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Missing confirmation token.');
      return;
    }
    api
      .post<{ ok: boolean; email: string }>('/auth/confirm-email-change', { token })
      .then((res) => {
        setEmail(res.email);
        setState('ok');
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.');
      });
  }, [token]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-teal-900 via-emerald-900 to-emerald-800 px-4">
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
        {state === 'working' && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
            <p className="text-sm text-slate-600">Confirming your new login email…</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✅</div>
            <h2 className="text-lg font-semibold text-slate-800">Login email updated!</h2>
            <p className="mt-1 text-sm text-slate-600">
              You can now sign in with <span className="font-medium text-slate-800">{email}</span>.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
            >
              Go to sign in
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-3xl">⚠️</div>
            <h2 className="text-lg font-semibold text-slate-800">Confirmation failed</h2>
            <p className="mt-1 text-sm text-slate-600">{message}</p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailChangePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
