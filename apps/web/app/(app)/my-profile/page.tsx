'use client';

import { useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';

export default function MyProfilePage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setOk('Password updated.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setBusy(false);
    }
  }

  const details: { label: string; value: string }[] = [
    { label: 'Company', value: user?.companyName || '—' },
    { label: 'Contact name', value: user?.name || '—' },
    { label: 'Email', value: user?.email || '—' },
    { label: 'Phone', value: user?.contactMobile || '—' },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="My Profile" subtitle="Your account details and password" />

      {/* Read-only registration details */}
      <div className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Account details</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            Managed by your account manager
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {details.map((d) => (
                <tr key={d.label} className="border-b border-slate-100 last:border-0">
                  <td className="w-40 bg-slate-50 px-4 py-2.5 font-medium text-slate-500">
                    {d.label}
                  </td>
                  <td className="px-4 py-2.5 text-slate-800">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          To change your name, email, or phone, contact your account manager.
        </p>
      </div>

      {/* Self-service password change */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Change password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="label">Current password</label>
            <input
              type="password"
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">New password</label>
              <input
                type="password"
                className="input"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
          </div>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
          )}
          {ok && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>
          )}
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? 'Please wait…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
