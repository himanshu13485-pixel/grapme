'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';

interface Record {
  found: boolean;
  record?: string | null;
  selector?: string | null;
}
interface AuthResult {
  domain: string;
  score: number;
  spf: Record;
  dmarc: Record;
  dkim: Record;
  advice: string;
}
interface ValidateResult {
  email: string;
  valid: boolean;
  syntaxOk: boolean;
  mxFound: boolean;
  reason: string;
}

export default function DeliverabilityPage() {
  const [domain, setDomain] = useState('google.com');
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [email, setEmail] = useState('');
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkDomain() {
    setBusy(true);
    try {
      setAuth(await api.get<AuthResult>(`/deliverability/email-auth?domain=${encodeURIComponent(domain)}`));
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setValidation(await api.post<ValidateResult>('/deliverability/validate-email', { email }));
  }

  return (
    <div>
      <PageHeader
        title="Deliverability"
        subtitle="Domain authentication & email validation"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Domain auth */}
        <div className="card p-6">
          <h3 className="mb-3 font-medium">Domain authentication</h3>
          <div className="mb-4 flex gap-2">
            <input
              className="input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="yourdomain.com"
            />
            <button className="btn-primary" onClick={checkDomain} disabled={busy}>
              {busy ? '…' : 'Check'}
            </button>
          </div>

          {auth && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-3xl font-semibold text-brand-700">
                  {auth.score}
                </div>
                <div className="text-sm text-slate-500">/ 100 auth score</div>
              </div>
              {(['spf', 'dmarc', 'dkim'] as const).map((k) => (
                <div
                  key={k}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span className="text-sm font-medium uppercase">{k}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      auth[k].found
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {auth[k].found ? 'Found' : 'Missing'}
                  </span>
                </div>
              ))}
              <p className="text-xs text-slate-400">{auth.advice}</p>
            </div>
          )}
        </div>

        {/* Email validation */}
        <div className="card p-6">
          <h3 className="mb-3 font-medium">Email validation</h3>
          <div className="mb-4 flex gap-2">
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
            />
            <button className="btn-primary" onClick={validate}>
              Validate
            </button>
          </div>

          {validation && (
            <div className="space-y-2 text-sm">
              <Line label="Syntax" ok={validation.syntaxOk} />
              <Line label="MX records" ok={validation.mxFound} />
              <div
                className={`mt-2 rounded-lg px-3 py-2 ${
                  validation.valid
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-700'
                }`}
              >
                {validation.valid ? 'Deliverable' : 'Not deliverable'} —{' '}
                {validation.reason}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={ok ? 'text-emerald-600' : 'text-rose-600'}>
        {ok ? '✓' : '✕'}
      </span>
    </div>
  );
}
