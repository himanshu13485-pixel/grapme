'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge, Tabs, Modal } from '@/components/ui';
import { LiSubscription, LinkedInAccount, LiCampaign, LiKnowledgeStats, accountHealth, timeAgo } from '@/lib/linkedin';
import { LiInbox } from '@/components/LiInbox';

export default function ClientLinkedInPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const [clientName, setClientName] = useState('');
  const [emailOn, setEmailOn] = useState(true);
  const [linkedInOn, setLinkedInOn] = useState<boolean | null>(null);
  const [tab, setTab] = useState('subscription');

  useEffect(() => {
    api.get<{ name: string; emailEnabled?: boolean; linkedInEnabled?: boolean }>(`/clients/${clientId}`)
      .then((c) => { setClientName(c.name); setEmailOn(c.emailEnabled !== false); setLinkedInOn(!!c.linkedInEnabled); })
      .catch(() => setLinkedInOn(false));
  }, [clientId]);

  return (
    <div>
      <Link href="/linkedin" className="text-sm text-slate-500 hover:text-slate-800">← LinkedIn Outreach</Link>
      <PageHeader title={`${clientName || 'Client'} · LinkedIn`} subtitle="Subscription, connected accounts, and campaigns for this client." />

      {/* Channel switcher — jump back to this client's Email workspace. */}
      <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => router.push(`/clients/${clientId}?channel=email`)}
          className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700"
        >
          📧 Email
          {!emailOn && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">Not subscribed</span>}
        </button>
        <button type="button" className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm">
          🔗 LinkedIn
        </button>
      </div>

      {linkedInOn === null ? (
        <EmptyState message="Loading…" />
      ) : linkedInOn === false ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="text-4xl opacity-70">🔗</div>
          <div className="text-lg font-semibold text-slate-700">LinkedIn channel — not subscribed</div>
          <p className="max-w-md text-sm text-slate-500">
            This client isn&apos;t subscribed to the LinkedIn outreach channel. Edit the client and set its Outreach channels to enable it.
          </p>
        </div>
      ) : (
        <>
          <Tabs
            tabs={[
              { key: 'subscription', label: 'Subscription' },
              { key: 'accounts', label: 'Accounts' },
              { key: 'campaigns', label: 'Campaigns' },
              { key: 'inbox', label: 'Inbox' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'subscription' && <SubscriptionTab clientId={clientId} />}
          {tab === 'accounts' && <AccountsTab clientId={clientId} />}
          {tab === 'campaigns' && <CampaignsTab clientId={clientId} />}
          {tab === 'inbox' && <LiInbox clientId={clientId} />}
        </>
      )}
    </div>
  );
}

// ── Subscription (separate LinkedIn billing) ─────────────────────────────
function SubscriptionTab({ clientId }: { clientId: string }) {
  const [sub, setSub] = useState<LiSubscription | null>(null);
  const [stats, setStats] = useState<LiKnowledgeStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([
      api.get<LiSubscription>(`/linkedin/clients/${clientId}/subscription`),
      api.get<LiKnowledgeStats>(`/linkedin/clients/${clientId}/knowledge-stats`),
    ]);
    setSub(s); setStats(st);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  if (!sub) return <EmptyState message="Loading…" />;

  const set = (k: keyof LiSubscription, v: any) => setSub({ ...sub, [k]: v });

  async function save() {
    setSaving(true); setMsg('');
    try {
      await api.patch(`/linkedin/clients/${clientId}/subscription`, {
        planName: sub!.planName, seats: Number(sub!.seats), validityDays: sub!.validityDays ? Number(sub!.validityDays) : undefined,
        whatsappEnabled: sub!.whatsappEnabled, whatsappNumber: sub!.whatsappNumber, timezone: sub!.timezone,
      });
      setMsg('Saved'); setTimeout(() => setMsg(''), 2000);
    } finally { setSaving(false); }
  }
  async function adjustCredits() {
    const raw = prompt('Adjust LinkedIn credits by (e.g. 100 or -50):');
    if (!raw) return;
    const amount = Number(raw);
    if (!amount) return;
    await api.post(`/linkedin/clients/${clientId}/subscription/credits`, { amount });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Seats" value={sub.seats} />
        <Stat label="Credits" value={sub.creditsBalance} action={<button onClick={adjustCredits} className="text-xs font-medium text-brand-700 hover:text-brand-800">Adjust</button>} />
        <Stat label="Validity (days)" value={sub.validityDays ?? '—'} />
        <Stat label="AI Knowledge" value={`${stats?.aiKnowledgePct ?? 0}%`} sub={`${stats?.profileCount ?? 0} profiles`} />
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-semibold">LinkedIn Plan</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name"><input className="input" value={sub.planName ?? ''} onChange={(e) => set('planName', e.target.value)} placeholder="e.g. Growth Plus" /></Field>
          <Field label="Seats"><input className="input" type="number" min={0} value={sub.seats} onChange={(e) => set('seats', e.target.value)} /></Field>
          <Field label="Validity (days)"><input className="input" type="number" min={0} value={sub.validityDays ?? ''} onChange={(e) => set('validityDays', e.target.value)} placeholder="30 / 180 / 360" /></Field>
          <Field label="Timezone"><input className="input" value={sub.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
          <Field label="WhatsApp notifications">
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sub.whatsappEnabled} onChange={(e) => set('whatsappEnabled', e.target.checked)} /> Enabled
            </label>
          </Field>
          <Field label="WhatsApp number"><input className="input" value={sub.whatsappNumber ?? ''} onChange={(e) => set('whatsappNumber', e.target.value)} placeholder="+91…" /></Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Plan'}</button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Accounts (connect via Unipile) ───────────────────────────────────────
function AccountsTab({ clientId }: { clientId: string }) {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setAccounts(await api.get<LinkedInAccount[]>(`/linkedin/clients/${clientId}/linkedin-accounts`));
    setLoaded(true);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function connect() {
    setBusy(true);
    try {
      const res = await api.post<{ accountId: string; url: string }>(`/linkedin/clients/${clientId}/linkedin-accounts/connect`, {});
      setConnectUrl(res.url); // show a shareable link; the account row is already created (PENDING)
      load();
    } catch (e: any) { alert(e.message ?? 'Failed to start connect'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" disabled={busy} onClick={connect}>{busy ? 'Starting…' : '+ Connect Account'}</button>
      </div>
      {connectUrl && <ConnectLinkModal url={connectUrl} onClose={() => { setConnectUrl(null); load(); }} />}
      {!loaded ? <EmptyState message="Loading…" /> : accounts.length === 0 ? (
        <EmptyState message="No LinkedIn accounts connected yet." />
      ) : (
        <>
          <AccountHealthSummary accounts={accounts} />
          <div className="card divide-y divide-slate-100">
            {accounts.map((a) => {
              const h = accountHealth(a.status);
              return (
                <div key={a.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <img src={a.avatarUrl || 'https://placehold.co/40x40/ede9fe/6d28d9?text=in'} alt="" className="h-10 w-10 rounded-full bg-brand-50 object-cover" />
                    <div>
                      <div className="font-medium text-slate-800">{a.fullName ?? 'Pending connection…'}</div>
                      <div className="line-clamp-1 text-xs text-slate-500">
                        {a.headline ?? (a.status === 'CONNECTED' ? 'LinkedIn account' : 'Awaiting LinkedIn auth')}
                        {a.connectionsCount != null && ` · ${a.connectionsCount} connections`}
                        {a.status === 'CONNECTED' && ` · synced ${timeAgo(a.lastSyncedAt)}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium ${h.text}`}>
                      <span className={`h-2 w-2 rounded-full ${h.dot}`} />{h.label}
                    </span>
                    <button className="text-sm text-slate-500 hover:text-slate-800" onClick={async () => { await api.post(`/linkedin/linkedin-accounts/${a.id}/sync`); load(); }}>Sync</button>
                    {h.attention && <button className="text-sm text-brand-600 hover:text-brand-800" onClick={connect}>Reconnect</button>}
                    <button className="text-sm text-rose-500 hover:text-rose-700" onClick={async () => { if (confirm('Remove this account?')) { await api.del(`/linkedin/linkedin-accounts/${a.id}`); load(); } }}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Roll-up of account connection health for the client's seats. */
function AccountHealthSummary({ accounts }: { accounts: LinkedInAccount[] }) {
  const connected = accounts.filter((a) => a.status === 'CONNECTED').length;
  const attention = accounts.filter((a) => accountHealth(a.status).attention);
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{connected} connected</span>
        <span className="text-slate-300">·</span>
        <span>{accounts.length} seat{accounts.length === 1 ? '' : 's'} used</span>
      </div>
      {attention.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          ⚠ {attention.length} account{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} attention — reconnect to resume sending.
          {' '}This campaign&apos;s sends pause for any account that isn&apos;t connected.
        </div>
      )}
    </div>
  );
}

/** Shareable Unipile hosted-auth link. Send it to the client, or open it yourself. */
function ConnectLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked — user can select the field manually */ }
  }
  return (
    <Modal open onClose={onClose} title="Connect a LinkedIn account" wide disableBackdropClose>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Whoever opens this link logs into the <strong>LinkedIn account to connect</strong> on Unipile&apos;s secure page
          (we never see the password). Send it to the client, or open it yourself if you have their login.
          The link expires in about <strong>60 minutes</strong>.
        </p>
        <div className="flex gap-2">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input flex-1 font-mono text-xs" />
          <button className="btn-ghost whitespace-nowrap" onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Once they finish, the account appears as <strong>Connected</strong> automatically. If it still shows
          “Pending”, click <strong>Sync</strong> on the account row.
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Done</button>
          <a href={url} target="_blank" rel="noreferrer" className="btn-primary">Open now →</a>
        </div>
      </div>
    </Modal>
  );
}

// ── Campaigns ────────────────────────────────────────────────────────────
function CampaignsTab({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<LiCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setCampaigns(await api.get<LiCampaign[]>(`/linkedin/campaigns?clientId=${clientId}`));
    setLoaded(true);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, path: string) { await api.post(`/linkedin/campaigns/${id}/${path}`); load(); }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Link href={`/linkedin/${clientId}/campaigns/new`} className="btn-primary">+ New Campaign</Link>
      </div>
      {!loaded ? <EmptyState message="Loading…" /> : campaigns.length === 0 ? (
        <EmptyState message="No campaigns yet." />
      ) : (
        <div className="card divide-y divide-slate-100">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <Link href={`/linkedin/${clientId}/campaigns/${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">{c.name}</Link>
                {c.mode === 'AI' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">AI</span>}
                <span className="text-xs text-slate-400">{c.outreachType === 'DIRECT_MESSAGES' ? 'Direct' : 'Connect'}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-500">{c._count?.leads ?? 0} leads</span>
                <StatusBadge status={c.status} />
                {c.status === 'RUNNING' ? (
                  <button className="btn-ghost px-2 py-1" onClick={() => act(c.id, 'pause')}>⏸ Pause</button>
                ) : (
                  <button className="btn-primary px-2 py-1" disabled={c.status === 'ARCHIVED'} onClick={() => act(c.id, 'resume')}>▶ Start</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── small helpers ────────────────────────────────────────────────────────
function Stat({ label, value, sub, action }: { label: string; value: React.ReactNode; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        {action}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium text-slate-600">{label}</label>{children}</div>;
}
