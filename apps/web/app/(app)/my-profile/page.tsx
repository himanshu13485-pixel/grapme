'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import ChannelVerify from '@/components/ChannelVerify';

export default function MyProfilePage() {
  const { user, refreshUser } = useAuth();
  const isClient = user?.role === 'CLIENT';

  // Notification preferences (email + WhatsApp alerts; the in-app bell is always on).
  const [prefs, setPrefs] = useState({
    notifyEmail: true,
    notifyWhatsapp: false,
    notifyTelegram: false,
    notifyNetvork: false,
    contactMobile: '',
    netvorkAppId: '',
  });
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState('');
  // Bumped after saving so the verify card re-reads status (the number may have changed).
  const [verifyKey, setVerifyKey] = useState(0);

  useEffect(() => {
    api
      .get<{
        notifyEmail?: boolean;
        notifyWhatsapp?: boolean;
        notifyTelegram?: boolean;
        notifyNetvork?: boolean;
        contactMobile?: string | null;
        netvorkAppId?: string | null;
      }>('/users/me/profile')
      .then((p) =>
        setPrefs({
          notifyEmail: p.notifyEmail ?? true,
          notifyWhatsapp: p.notifyWhatsapp ?? false,
          notifyTelegram: p.notifyTelegram ?? false,
          notifyNetvork: !!p.notifyNetvork,
          contactMobile: p.contactMobile ?? '',
          netvorkAppId: p.netvorkAppId ?? '',
        }),
      )
      .catch(() => {});
  }, []);

  async function savePrefs() {
    setPrefsBusy(true);
    setPrefsMsg('');
    try {
      await api.patch('/users/me/profile', {
        notifyEmail: prefs.notifyEmail,
        notifyWhatsapp: prefs.notifyWhatsapp,
        notifyTelegram: prefs.notifyTelegram,
        ...(isClient ? {} : { contactMobile: prefs.contactMobile }),
        netvorkAppId: prefs.netvorkAppId,
      });
      setPrefsMsg('Notification preferences saved.');
      setVerifyKey((k) => k + 1);
    } catch {
      setPrefsMsg('Could not save. Please try again.');
    } finally {
      setPrefsBusy(false);
    }
  }

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

      {/* Notification preferences */}
      <div className="card mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Notification preferences</h2>
        <p className="mb-4 text-xs text-slate-400">
          Controls all alerts, including Client Support tickets. In-app alerts (the bell)
          always stay on. Sign-in and password emails are always sent.
        </p>
        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">Email alerts</span>
              <span className="block text-xs text-slate-400">New ticket replies, updates, and other alerts by email.</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={prefs.notifyEmail}
              onChange={(e) => setPrefs({ ...prefs, notifyEmail: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">WhatsApp alerts</span>
              <span className="block text-xs text-slate-400">The same alerts on WhatsApp (requires a verified number below).</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={prefs.notifyWhatsapp}
              onChange={(e) => setPrefs({ ...prefs, notifyWhatsapp: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">Telegram alerts</span>
              <span className="block text-xs text-slate-400">The same alerts on Telegram, verified separately — the two are independent.</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={prefs.notifyTelegram}
              onChange={(e) => setPrefs({ ...prefs, notifyTelegram: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">Netvork alerts</span>
              <span className="block text-xs text-slate-400">
                The same alerts as a Netvork message — they reach your bell and your phone.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={prefs.notifyNetvork}
              onChange={(e) => setPrefs({ ...prefs, notifyNetvork: e.target.checked })}
            />
          </label>
          {isClient ? (
            // Clients already gave their number at registration — show it, don't re-ask.
            (prefs.notifyWhatsapp || prefs.notifyTelegram) && (
              <p className="text-xs text-slate-500">
                {prefs.contactMobile
                  ? <>Alerts will be sent to your registered number <strong className="text-slate-700">{prefs.contactMobile}</strong>. To change it, contact your account manager.</>
                  : <>No number is on file. Contact your account manager to add one.</>}
              </p>
            )
          ) : (
            <div>
              <label className="label">Mobile number</label>
              <input
                className="input"
                value={prefs.contactMobile}
                placeholder="+1 555 000 1234"
                onChange={(e) => setPrefs({ ...prefs, contactMobile: e.target.value })}
              />
            </div>
          )}

          {/* Netvork is an account on our own network rather than a number on
              someone else's, so it is asked for separately — and it is theirs
              to set even on a client login, where the mobile number is not. */}
          <div>
            <label className="label">Netvork App ID</label>
            <input
              className="input"
              value={prefs.netvorkAppId}
              placeholder="NV-1234 — or your Netvork username or email"
              onChange={(e) => setPrefs({ ...prefs, netvorkAppId: e.target.value })}
            />
          </div>

          {/* Proof that the address is theirs — alerts only go to verified ones. */}
          <ChannelVerify
            key={`wa-${verifyKey}`}
            channel="whatsapp"
            onVerified={() => setPrefs((p) => ({ ...p, notifyWhatsapp: true }))}
          />
          <ChannelVerify
            key={`tg-${verifyKey}`}
            channel="telegram"
            onVerified={() => setPrefs((p) => ({ ...p, notifyTelegram: true }))}
          />
          <ChannelVerify
            key={`nv-${verifyKey}`}
            channel="netvork"
            onVerified={() => setPrefs((p) => ({ ...p, notifyNetvork: true }))}
          />
          {prefsMsg && (
            <p className={`rounded-lg px-3 py-2 text-sm ${prefsMsg.startsWith('Could not') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
              {prefsMsg}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={prefsBusy} onClick={savePrefs}>
            {prefsBusy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </div>

      {/* AI template assistant (super admin only) */}
      {user?.role === 'SUPER_ADMIN' && <AiSettingsCard />}

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

/** OpenAI key + model for the AI template assistant. One key per tenant, set by
 *  the super admin, used by admins/sub-admins to draft templates. Write-only:
 *  the key never comes back to the browser — only a "configured" status. */
function AiSettingsCard() {
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState('gpt-5.6-luna');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ configured: boolean; model: string }>('/ai/settings')
      .then((s) => { setConfigured(s.configured); setModel(s.model || 'gpt-5.6-luna'); })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true); setMsg(''); setErr('');
    try {
      // Only send the key when the admin actually typed a new one (blank keeps the current).
      const body: { model: string; apiKey?: string } = { model: model.trim() };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const s = await api.put<{ configured: boolean; model: string }>('/ai/settings', body);
      setConfigured(s.configured); setModel(s.model); setApiKey('');
      setMsg('AI settings saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally { setBusy(false); }
  }
  async function testKey() {
    setBusy(true); setMsg(''); setErr('');
    try {
      const body: { apiKey?: string; model?: string } = {};
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (model.trim()) body.model = model.trim();
      const r = await api.post<{ ok: boolean; model: string }>('/ai/settings/test', body);
      setMsg(`✓ Key works with ${r.model}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Test failed.');
    } finally { setBusy(false); }
  }
  async function clearKey() {
    if (!confirm('Remove the stored OpenAI key? Template generation will stop working until a new key is added.')) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const s = await api.put<{ configured: boolean; model: string }>('/ai/settings', { apiKey: '' });
      setConfigured(s.configured); setApiKey('');
      setMsg('Key removed.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card mb-6 p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">AI template assistant (OpenAI)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Powers ✨ Generate with AI on the client-workspace Templates tab (admins &amp; sub-admins only).
        The key is stored encrypted and never shown again. Get a key from platform.openai.com.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            OpenAI API key {configured && <span className="text-emerald-600">· ✓ configured</span>}
          </label>
          <input
            type="password"
            className="input"
            autoComplete="off"
            placeholder={configured ? '•••••••• (leave blank to keep)' : 'sk-…'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Model</label>
          <input
            className="input"
            placeholder="gpt-5.6-luna"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-slate-400">Default gpt-5.6-luna (cheapest). Others: gpt-5.6-terra, gpt-5.6-sol.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save AI settings'}</button>
        <button type="button" className="btn-ghost text-sm" disabled={busy || (!configured && !apiKey.trim())} onClick={testKey} title="Make a tiny OpenAI call to verify the key and model">Test key</button>
        {configured && <button type="button" className="btn-ghost text-sm text-rose-600" disabled={busy} onClick={clearKey}>Remove key</button>}
        {msg && <span className="text-xs text-emerald-600">{msg}</span>}
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
