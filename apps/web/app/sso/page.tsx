'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, getDevicePass, setToken, setRefreshToken } from '@/lib/api';
import { landingFor } from '@/lib/impersonate';

interface SsoResponse {
  accessToken: string;
  refreshToken: string;
  user: { role: string };
}

/**
 * Landing here from GrapOut Trade, already signed in over there.
 *
 * The URL carries a one-minute, one-use pass; this trades it for a session and
 * gets out of the way — on a browser that has signed in to GrapMe with a
 * password before. On any other, the server says to sign in once first. A pass that fails — expired, reused, or for an address
 * with no account here — ends on the ordinary sign-in page with a sentence
 * saying why, because the person still wants to get in.
 */
function SsoInner() {
  const params = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
  // React's development double-invoke would otherwise spend the pass twice,
  // and the second attempt — correctly — is refused.
  const spent = useRef(false);

  useEffect(() => {
    if (spent.current) return;
    spent.current = true;

    const ticket = params.get('ticket');
    if (!ticket) {
      setProblem('That link is missing its pass. Please sign in.');
      return;
    }

    // Used the moment it is read: keep it out of the history so Back cannot
    // replay a spent link.
    window.history.replaceState(null, '', window.location.pathname);

    api
      .post<SsoResponse>('/auth/sso', { ticket, devicePass: getDevicePass() ?? undefined })
      .then((res) => {
        setToken(res.accessToken);
        setRefreshToken(res.refreshToken);
        // A full load, so every provider starts from the new identity.
        window.location.href = landingFor(res.user.role);
      })
      .catch((err) => setProblem(err instanceof Error ? err.message : 'Could not sign you in.'));
  }, [params]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 px-4">
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
        {problem ? (
          <>
            <p className="text-sm text-slate-600">{problem}</p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
            >
              Sign in to GrapMe
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="text-sm text-slate-600">Signing you in from GrapOut Trade…</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function SsoPage() {
  return (
    <Suspense fallback={null}>
      <SsoInner />
    </Suspense>
  );
}
