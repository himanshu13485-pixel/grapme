'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Captcha {
  token: string;
  question: string;
}

export default function ClientPortalPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [forgotSent, setForgotSent] = useState(false);

  // shared
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // register-only
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [mobile, setMobile] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [registered, setRegistered] = useState('');

  const loadCaptcha = useCallback(() => {
    api
      .get<Captcha>('/auth/captcha')
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(() => {
    if (mode === 'register') loadCaptcha();
  }, [mode, loadCaptcha]);

  // grapme.com links here with ?mode=register so "Sign up" opens the sign-up form
  // directly instead of the sign-in form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('mode') === 'register') setMode('register');
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      router.replace('/clients');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ success: boolean; email: string }>(
        '/auth/client/register',
        {
          companyName,
          contactName,
          mobile: mobile || undefined,
          email,
          password,
          captchaToken: captcha?.token ?? '',
          captchaAnswer,
        },
      );
      setRegistered(res.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setCaptchaAnswer('');
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-teal-900 via-emerald-900 to-emerald-800 px-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-teal-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-400/30 blur-3xl" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-2xl font-black text-white shadow-lg">
            G
          </div>
          <h1 className="bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            GrapMe
          </h1>
          <p className="mt-1 text-sm text-slate-500">GVC Framework · Client Portal</p>
        </div>

        {registered ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
              📧
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Confirm your email</h2>
            <p className="text-sm text-slate-600">
              We sent a confirmation link to <b>{registered}</b>. Click it to activate
              your account, then sign in here.
            </p>
            <button
              className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
              onClick={() => {
                setRegistered('');
                setMode('login');
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : mode === 'login' ? (
          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">Password</label>
                <button
                  type="button"
                  className="mb-1 text-xs font-medium text-emerald-600 hover:underline"
                  onClick={() => {
                    setError('');
                    setForgotSent(false);
                    setMode('forgot');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowPw((s) => !s)}
                  className="absolute inset-y-0 right-3 my-auto h-6 text-xs font-medium text-slate-500 hover:text-slate-700">
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
            )}
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        ) : mode === 'forgot' ? (
          forgotSent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
                📧
              </div>
              <h2 className="text-lg font-semibold text-slate-800">Check your email</h2>
              <p className="text-sm text-slate-600">
                If an account exists for <b>{email}</b>, we&apos;ve sent a password-reset
                link. It expires in 1 hour.
              </p>
              <button
                className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
                onClick={() => {
                  setForgotSent(false);
                  setMode('login');
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={onForgot} className="space-y-4">
              <p className="text-sm text-slate-600">
                Enter your account email and we&apos;ll send you a link to reset your
                password.
              </p>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
              )}
              <button
                type="submit"
                className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-60"
                disabled={busy}
              >
                {busy ? 'Please wait…' : 'Send reset link'}
              </button>
            </form>
          )
        ) : (
          <form onSubmit={onRegister} className="space-y-3.5">
            <div>
              <label className="label">Company name *</label>
              <input
                className="input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Contact name *</label>
              <input
                className="input"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Contact no. (with country code)</label>
              <input
                className="input"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="label">Email *</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Password *</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
                <button type="button" onClick={() => setShowPw((s) => !s)}
                  className="absolute inset-y-0 right-3 my-auto h-6 text-xs font-medium text-slate-500 hover:text-slate-700">
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label className="label">
                Captcha — what is <b>{captcha?.question ?? '…'}</b>?
              </label>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  inputMode="numeric"
                  placeholder="Answer"
                  required
                />
                <button
                  type="button"
                  onClick={loadCaptcha}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-500 hover:bg-slate-50"
                  title="New captcha"
                >
                  ↻
                </button>
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
            )}
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Please wait…' : 'Create account'}
            </button>
          </form>
        )}

        {!registered && mode !== 'forgot' && (
          <p className="mt-6 text-center text-sm text-slate-500">
            {mode === 'login' ? "New client? " : 'Already registered? '}
            <button
              className="font-medium text-emerald-600 hover:underline"
              onClick={() => {
                setError('');
                setMode(mode === 'login' ? 'register' : 'login');
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        )}
        {!registered && mode === 'forgot' && !forgotSent && (
          <p className="mt-6 text-center text-sm text-slate-500">
            Remembered it?{' '}
            <button
              className="font-medium text-emerald-600 hover:underline"
              onClick={() => {
                setError('');
                setMode('login');
              }}
            >
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
