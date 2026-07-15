'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';

type FieldErrors = { name?: string; phone?: string; email?: string; captcha?: string };

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidPhone(v: string) {
  const digits = v.replace(/[^\d]/g, '');
  return /^[+\d][\d\s\-()]{6,}$/.test(v.trim()) && digits.length >= 7 && digits.length <= 15;
}

export function LeadForm({
  heading = 'Book a demo',
  sub = 'Leave your details and we’ll walk you through it live.',
}: {
  heading?: string;
  sub?: string;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [captcha, setCaptcha] = useState<{ token: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const loadCaptcha = useCallback(async () => {
    setCaptchaAnswer('');
    try {
      const res = await fetch('/api/captcha', { cache: 'no-store' });
      setCaptcha(res.ok ? await res.json() : null);
    } catch {
      setCaptcha(null);
    }
  }, []);
  useEffect(() => { loadCaptcha(); }, [loadCaptcha]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const nextErrors: FieldErrors = {};
    if (name.trim().length < 2) nextErrors.name = 'Please enter your name.';
    if (!isValidPhone(phone)) nextErrors.phone = 'Please enter a valid contact number.';
    if (!isValidEmail(email)) nextErrors.email = 'Please enter a valid email address.';
    if (!captchaAnswer.trim()) nextErrors.captcha = 'Please answer the question.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setStatus('submitting');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(), email: email.trim(),
          captchaToken: captcha?.token ?? '', captchaAnswer: captchaAnswer.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.errors?.captcha) {
          setErrors({ captcha: data.errors.captcha });
          setStatus('idle');
          loadCaptcha(); // fresh challenge after a wrong answer
          return;
        }
        throw new Error('Request failed');
      }
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-line bg-paper p-9 text-center shadow-card">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-teal-light text-teal">
          <Check size={26} />
        </span>
        <h4 className="mb-1.5 font-display text-2xl font-bold text-ink">You&apos;re on the list</h4>
        <p className="text-sm text-muted">We&apos;ve got your details. Our team will reach out shortly.</p>
      </div>
    );
  }

  const field =
    'w-full rounded-xl border bg-mist px-4 py-3.5 text-[15px] font-medium text-ink outline-none transition placeholder:text-faint focus:border-brand focus:bg-paper focus:ring-2 focus:ring-brand-100';

  return (
    <div className="rounded-2xl border border-line bg-paper p-8 text-left shadow-card">
      <h3 className="mb-1 text-center font-display text-2xl font-bold text-ink">{heading}</h3>
      <p className="mb-6 text-center text-sm text-muted">{sub}</p>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1">
          <label htmlFor="lead-name" className="mb-1.5 block text-[13px] font-bold text-ink">
            Name
          </label>
          <input
            id="lead-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
            className={`${field} ${errors.name ? 'border-danger' : 'border-line'}`}
          />
          {errors.name && <p className="mt-1.5 text-xs font-semibold text-danger">{errors.name}</p>}
        </div>

        <div className="flex-1">
          <label htmlFor="lead-phone" className="mb-1.5 block text-[13px] font-bold text-ink">
            Contact no.
          </label>
          <input
            id="lead-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +91 98765 43210"
            autoComplete="tel"
            inputMode="tel"
            className={`${field} ${errors.phone ? 'border-danger' : 'border-line'}`}
          />
          {errors.phone && <p className="mt-1.5 text-xs font-semibold text-danger">{errors.phone}</p>}
        </div>

        <div className="flex-1">
          <label htmlFor="lead-email" className="mb-1.5 block text-[13px] font-bold text-ink">
            Work email
          </label>
          <input
            id="lead-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            className={`${field} ${errors.email ? 'border-danger' : 'border-line'}`}
          />
          {errors.email && <p className="mt-1.5 text-xs font-semibold text-danger">{errors.email}</p>}
        </div>

        <div className="w-full md:w-auto">
          <label htmlFor="lead-captcha" className="mb-1.5 block text-[13px] font-bold text-ink">
            {captcha ? `What is ${captcha.question}?` : 'Verify'}
          </label>
          <input
            id="lead-captcha"
            value={captchaAnswer}
            onChange={(e) => setCaptchaAnswer(e.target.value)}
            placeholder="Answer"
            inputMode="numeric"
            autoComplete="off"
            aria-label={captcha ? `What is ${captcha.question}?` : 'Captcha answer'}
            className={`${field} md:w-28 ${errors.captcha ? 'border-danger' : 'border-line'}`}
          />
          {errors.captcha && <p className="mt-1.5 text-xs font-semibold text-danger">{errors.captcha}</p>}
        </div>

        <button
          type="submit"
          disabled={status === 'submitting' || !captcha}
          className="inline-flex h-[52px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-7 text-[15px] font-extrabold text-white transition hover:bg-brand disabled:opacity-60"
        >
          {status === 'submitting' ? 'Sending…' : 'Get in touch'}
          {status !== 'submitting' && <ArrowUpRight size={16} />}
        </button>
      </form>

      {status === 'error' && (
        <p className="mt-3 text-center text-xs font-semibold text-danger">
          Something went wrong. Please try again or WhatsApp us directly.
        </p>
      )}

      <p className="mt-4 text-center text-xs text-faint">By submitting you agree to be contacted about GrapMe.</p>
    </div>
  );
}
