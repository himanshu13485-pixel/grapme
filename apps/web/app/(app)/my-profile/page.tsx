'use client';

import { useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';

export default function MyProfilePage() {
  const { user, refreshUser } = useAuth();
  const isClient = user?.role === 'CLIENT';

  // Account (admins/users can edit name + email; clients see it read-only).
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMsg, setAcctMsg] = useState('');
  const [acctErr, setAcctErr] = useState('');

  // Password change (everyone).
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwOk, setPwOk] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    setAcctErr('');
    setAcctMsg('');
    setAcctBusy(true);
    try {
      await api.patch('/auth/account', { name, email });
      await refreshUser();
      setAcctMsg('Account updated.');
    } catch (err) {
      setAcctErr(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setAcctBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwErr('');
    setPwOk('');
    if (next !== confirm) {
      setPwErr('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setPwOk('Password updated.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="My Account" subtitle="Your login details and password" />

      {/* Account details */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Account details</h2>
        {isClient ? (
          <>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: 'Company', value: user?.companyName || '—' },
                    { label: 'Contact name', value: user?.name || '—' },
                    { label: 'Email', value: user?.email || '—' },
                    { label: 'Phone', value: user?.contactMobile || '—' },
                  ].map((d) => (
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
          </>
        ) : (
          <form onSubmit={saveAccount} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Login email</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            {acctErr && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{acctErr}</p>
            )}
            {acctMsg && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{acctMsg}</p>
            )}
            <button type="submit" className="btn-primary" disabled={acctBusy}>
              {acctBusy ? 'Saving…' : 'Save account'}
            </button>
          </form>
        )}
      </div>

      {/* Password change */}
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
          {pwErr && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{pwErr}</p>
          )}
          {pwOk && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{pwOk}</p>
          )}
          <button type="submit" className="btn-primary" disabled={pwBusy}>
            {pwBusy ? 'Please wait…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
