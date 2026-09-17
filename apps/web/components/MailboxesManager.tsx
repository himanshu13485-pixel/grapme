'use client';

import { useEffect, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth, useCanDelete } from '@/lib/auth';
import { PageHeader, StatusBadge, EmptyState, Modal, Pagination } from '@/components/ui';

interface AuthResult {
  domain?: string;
  score?: number;
  spf?: { found: boolean };
  dmarc?: { found: boolean };
  dkim?: { found: boolean; selector?: string | null };
  advice?: string;
  loading?: boolean;
  error?: boolean;
}

interface Mailbox {
  id: string;
  label: string;
  emailAddress: string;
  protocol: string;
  status: string;
  statusReason?: string | null;
  dailyLimit: number;
  smtpUsername?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpEncryption?: string;
  imapHost?: string;
  imapPort?: number;
  imapEncryption?: string;
  imapUsername?: string;
  imapAllowSelfSigned?: boolean;
  sendSpeedSeconds?: number;
  warmupEnabled?: boolean;
}

/**
 * Mailbox manager. Standalone on /mailboxes, or scoped to one client inside the
 * Clients Workspace (clientId) — listing only that client's mailboxes and
 * allocating new ones to it.
 */
export function MailboxesManager({ clientId }: { clientId?: string }) {
  const canDelete = useCanDelete();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN';
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<Record<string, string>>({});
  const [testMailbox, setTestMailbox] = useState<Mailbox | null>(null);
  const [editMailbox, setEditMailbox] = useState<Mailbox | null>(null);
  const [form, setForm] = useState({
    label: '',
    protocol: 'SMTP',
    emailAddress: '',
    smtpUsername: '',
    password: '',
    smtpHost: '',
    smtpPort: 587,
    smtpEncryption: 'STARTTLS',
    imapHost: '',
    imapPort: 993,
    imapEncryption: 'SSL',
    imapUsername: '',
    imapPassword: '',
    imapAllowSelfSigned: false,
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [auth, setAuth] = useState<Record<string, AuthResult>>({});
  // Tenant-wide report-sender mailbox (only managed on the global page).
  const [reportSenderId, setReportSenderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  async function checkAuth(m: Mailbox) {
    const domain = m.emailAddress.split('@')[1];
    if (!domain) return;
    setAuth((a) => ({ ...a, [m.id]: { loading: true } }));
    try {
      const r = await api.get<AuthResult>(
        `/deliverability/email-auth?domain=${encodeURIComponent(domain)}`,
      );
      setAuth((a) => ({ ...a, [m.id]: r }));
    } catch {
      setAuth((a) => ({ ...a, [m.id]: { error: true } }));
    }
  }

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  }

  function load() {
    const q = clientId ? `?clientId=${clientId}` : '';
    api
      .get<Mailbox[]>(`/email-accounts${q}`)
      .then((mbs) => {
        setMailboxes(mbs);
        loadAuth(mbs);
      })
      .catch(() => {});
    if (!clientId)
      api
        .get<{ mailboxId: string | null }>('/reports/sender')
        .then((r) => setReportSenderId(r.mailboxId))
        .catch(() => {});
  }
  useEffect(load, [clientId]);

  // Auto-populate each mailbox's SPF/DKIM/DMARC badge (cached server-side).
  async function loadAuth(mbs: Mailbox[]) {
    try {
      const byDomain = await api.get<
        Record<string, { score: number; spf: boolean; dkim: boolean; dmarc: boolean }>
      >('/deliverability/mailbox-auth');
      setAuth((prev) => {
        const next: Record<string, AuthResult> = {};
        for (const m of mbs) {
          const d = m.emailAddress.split('@')[1]?.toLowerCase();
          const r = d ? byDomain[d] : undefined;
          if (r)
            next[m.id] = {
              score: r.score,
              spf: { found: r.spf },
              dkim: { found: r.dkim },
              dmarc: { found: r.dmarc },
            };
        }
        // A manual "Check auth" result (fuller detail) takes precedence.
        return { ...next, ...prev };
      });
    } catch {
      /* ignore — badges just won't show */
    }
  }

  async function setReportSender(m: Mailbox) {
    try {
      await api.post('/reports/sender', { mailboxId: m.id });
      setReportSenderId(m.id);
      flash(`Client reports now send from ${m.emailAddress}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set report sender');
    }
  }

  /** Switch a disabled mailbox back on. The server also starts it a fresh bounce window. */
  async function enableMailbox(m: Mailbox) {
    if (!confirm(`Re-enable "${m.label}"?\n\nIt starts sending again. Clean the bounced addresses out of its list first, or it will be disabled again.`)) return;
    try {
      await api.post(`/email-accounts/${m.id}/enable`, {});
      flash(`"${m.label}" re-enabled — the bounce check starts fresh from now.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not re-enable the mailbox');
    }
  }

  async function removeMailbox(m: Mailbox) {
    if (!confirm(`Delete mailbox "${m.label}" (${m.emailAddress})?`)) return;
    try {
      await api.del(`/email-accounts/${m.id}`);
      flash('Mailbox deleted.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function replicateMailbox(m: Mailbox) {
    if (!confirm(`Replicate "${m.label}" (${m.emailAddress})?\n\nCreates a copy with the same server, ports, security, limits and credentials — staged for approval. Then Edit the copy to set the new email address (and password) for the related mailbox.`)) return;
    try {
      await api.post(`/email-accounts/${m.id}/duplicate`, {});
      flash('Mailbox replicated — edit the copy to set the new email address.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replicate failed');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/email-accounts', {
        ...form,
        smtpPort: Number(form.smtpPort),
        imapPort: Number(form.imapPort),
        clientId: clientId || undefined,
      });
      setShow(false);
      flash(
        clientId
          ? 'Mailbox added & allocated to this client — pending admin approval.'
          : 'Mailbox added — sent to admin for approval.',
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function runTest(id: string) {
    setTest({ ...test, [id]: 'testing…' });
    try {
      const res = await api.post<{ reachable: boolean; detail: string }>(
        `/email-accounts/${id}/test`,
      );
      setTest({ ...test, [id]: res.detail });
    } catch (err) {
      setTest({ ...test, [id]: err instanceof Error ? err.message : 'Failed' });
    }
  }

  async function runImapTest(id: string) {
    setTest({ ...test, [id]: 'checking inbox (IMAP)…' });
    try {
      const res = await api.post<{
        ok: boolean;
        detail: string;
        recentCount?: number;
        latest?: { from?: string; subject?: string; date?: string }[];
      }>(`/email-accounts/${id}/test-imap`);
      const lines = (res.latest ?? [])
        .map(
          (m) =>
            `• ${m.from ?? '?'} — ${m.subject ?? '(no subject)'}${
              m.date ? ` (${new Date(m.date).toLocaleString()})` : ''
            }`,
        )
        .join('\n');
      setTest({
        ...test,
        [id]: res.detail + (lines ? `\n${lines}` : ''),
      });
    } catch (err) {
      setTest({ ...test, [id]: err instanceof Error ? err.message : 'Failed' });
    }
  }

  return (
    <div>
      {clientId ? (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Mailboxes allocated to this client. New ones are added to its sending group.
          </p>
          <button className="btn-primary" onClick={() => setShow((s) => !s)}>
            {show ? 'Cancel' : '+ Add mailbox'}
          </button>
        </div>
      ) : (
        <PageHeader
          title="Mailboxes"
          subtitle="Credentials are encrypted; new mailboxes need admin approval"
          action={
            <button className="btn-primary" onClick={() => setShow((s) => !s)}>
              {show ? 'Cancel' : '+ Add mailbox'}
            </button>
          }
        />
      )}

      {!clientId && isAdmin && <BouncePolicyCard />}

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {show && (
        <form onSubmit={create} className="card mb-6 space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Label</label>
              <input
                className="input"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Protocol</label>
              <select
                className="input"
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                <option>SMTP</option>
                <option>IMAP</option>
                <option>POP</option>
              </select>
            </div>
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                value={form.emailAddress}
                onChange={(e) =>
                  setForm({ ...form, emailAddress: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="label">SMTP username (optional)</label>
              <input
                className="input"
                value={form.smtpUsername}
                onChange={(e) =>
                  setForm({ ...form, smtpUsername: e.target.value })
                }
                placeholder="Only if login ≠ email, e.g. AWS SES AKIA…"
              />
            </div>
            <div>
              <label className="label">Password / app-password</label>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">SMTP host</label>
              <input
                className="input"
                value={form.smtpHost}
                onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="label">SMTP port</label>
              <input
                type="number"
                className="input"
                value={form.smtpPort}
                onChange={(e) =>
                  setForm({ ...form, smtpPort: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label">SMTP encryption</label>
              <select
                className="input"
                value={form.smtpEncryption}
                onChange={(e) => setForm({ ...form, smtpEncryption: e.target.value })}
              >
                <option value="SSL">SSL / TLS (usually port 465)</option>
                <option value="STARTTLS">STARTTLS (usually port 587)</option>
                <option value="NONE">None (unencrypted)</option>
              </select>
            </div>
            <div>
              <label className="label">IMAP host (for receiving)</label>
              <input
                className="input"
                value={form.imapHost}
                onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                placeholder="mail.yourdomain.com"
              />
            </div>
            <div>
              <label className="label">IMAP port</label>
              <input
                type="number"
                className="input"
                value={form.imapPort}
                onChange={(e) =>
                  setForm({ ...form, imapPort: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label">IMAP encryption</label>
              <select
                className="input"
                value={form.imapEncryption}
                onChange={(e) => setForm({ ...form, imapEncryption: e.target.value })}
              >
                <option value="SSL">SSL / TLS (usually port 993)</option>
                <option value="STARTTLS">STARTTLS (usually port 143)</option>
                <option value="NONE">None (unencrypted)</option>
              </select>
            </div>
            <div>
              <label className="label">IMAP username (optional)</label>
              <input
                className="input"
                value={form.imapUsername}
                onChange={(e) =>
                  setForm({ ...form, imapUsername: e.target.value })
                }
                placeholder="Defaults to email; set if mail host differs"
              />
            </div>
            <div>
              <label className="label">IMAP password (optional)</label>
              <input
                type="password"
                className="input"
                value={form.imapPassword}
                onChange={(e) =>
                  setForm({ ...form, imapPassword: e.target.value })
                }
                placeholder="Mailbox password (if different from SMTP)"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.imapAllowSelfSigned}
              onChange={(e) =>
                setForm({ ...form, imapAllowSelfSigned: e.target.checked })
              }
            />
            Allow self-signed IMAP certificate (self-hosted mail servers)
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary">Add mailbox</button>
        </form>
      )}

      {mailboxes.length === 0 ? (
        <EmptyState message="No mailboxes connected yet." />
      ) : (
        <>
        <div className="mb-3 text-sm text-slate-400">{mailboxes.length} mailbox{mailboxes.length === 1 ? '' : 'es'}</div>
        <div className="space-y-3">
          {[...mailboxes]
            .sort((a, b) =>
              a.id === reportSenderId ? -1 : b.id === reportSenderId ? 1 : 0,
            )
            .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            .map((m) => (
            <div
              key={m.id}
              className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{m.label}</div>
                  {!clientId && reportSenderId === m.id && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                      ★ Admin / report sender
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {m.emailAddress} · {m.protocol} · cap {m.dailyLimit}/day
                </div>
                {test[m.id] && (
                  <div className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{test[m.id]}</div>
                )}
                {auth[m.id] && <AuthStatus result={auth[m.id]} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={m.status} />
                {m.status === 'DISABLED' && m.statusReason && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700" title={m.statusReason}>
                    ⚠ {m.statusReason}
                  </span>
                )}
                {m.status === 'DISABLED' && isAdmin && (
                  <button
                    className="btn-ghost px-3 py-1 text-xs text-emerald-700"
                    onClick={() => enableMailbox(m)}
                    title="Start sending again, with a fresh bounce window"
                  >
                    ↻ Re-enable
                  </button>
                )}
                {!clientId &&
                  (reportSenderId === m.id ? (
                    <span className="px-3 py-1 text-xs font-medium text-violet-600">
                      Report sender
                    </span>
                  ) : (
                    <button
                      className="btn-ghost px-3 py-1 text-xs"
                      onClick={() => setReportSender(m)}
                      title="Use this mailbox as the admin address for client reports"
                    >
                      Use as report sender
                    </button>
                  ))}
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => setEditMailbox(m)}
                >
                  Edit
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => checkAuth(m)}
                >
                  Check DNS auth
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => runTest(m.id)}
                >
                  Test connection
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => runImapTest(m.id)}
                >
                  Test inbox (IMAP)
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => setTestMailbox(m)}
                >
                  Send test email
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => replicateMailbox(m)}
                  title="Create a copy with the same server settings for another related email address"
                >
                  ⧉ Replicate
                </button>
                {canDelete && (
                  <button
                    className="btn-ghost px-3 py-1 text-xs text-rose-600"
                    onClick={() => removeMailbox(m)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={mailboxes.length} onPage={setPage} />
        </>
      )}

      <Modal
        open={!!testMailbox}
        onClose={() => setTestMailbox(null)}
        title={
          testMailbox ? `Send test email · ${testMailbox.label}` : 'Send test'
        }
      >
        {testMailbox && (
          <SendTestForm
            mailbox={testMailbox}
            onClose={() => setTestMailbox(null)}
          />
        )}
      </Modal>

      <Modal
        open={!!editMailbox}
        onClose={() => setEditMailbox(null)}
        title={editMailbox ? `Edit mailbox · ${editMailbox.label}` : 'Edit'}
        wide
      >
        {editMailbox && (
          <EditMailboxForm
            mailbox={editMailbox}
            onDone={() => {
              setEditMailbox(null);
              flash('Mailbox updated successfully.');
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/**
 * The bounce ceiling the auto-disable breaker enforces, tenant-wide. Above this share of
 * recent sends bouncing, a mailbox is switched off before it burns more sender reputation.
 */
function BouncePolicyCard() {
  const [pct, setPct] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<{ maxRatePct: number }>('/email-accounts/bounce-policy')
      .then((r) => { setPct(r.maxRatePct); setDraft(String(r.maxRatePct)); })
      .catch(() => {});
  }, []);

  if (pct === null) return null;
  const n = Math.floor(Number(draft));
  const valid = Number.isFinite(n) && n >= 1 && n <= 100;

  async function save() {
    if (!valid) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.patch<{ maxRatePct: number }>('/email-accounts/bounce-policy', { maxRatePct: n });
      setPct(r.maxRatePct);
      setMsg('Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-700">Auto-disable on bounces</div>
          <p className="text-xs text-slate-500">
            A mailbox is switched off when more than this share of its recent sends bounce (checked hourly, over its last 100 sends, once it has sent at least 20).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            className="input w-20"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="text-sm text-slate-500">%</span>
          <button className="btn-ghost text-xs" disabled={busy || !valid || n === pct} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {msg && <span className={`text-xs ${msg === 'Saved' ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</span>}
        </div>
      </div>
      {valid && n > 10 && (
        <p className="mt-1 text-[11px] text-amber-600">
          Above ~10% most providers start throttling or blocking the sender.
        </p>
      )}
    </div>
  );
}

function EditMailboxForm({
  mailbox,
  onDone,
}: {
  mailbox: Mailbox;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    label: mailbox.label,
    protocol: mailbox.protocol,
    emailAddress: mailbox.emailAddress,
    smtpUsername: mailbox.smtpUsername ?? '',
    password: '',
    smtpHost: mailbox.smtpHost ?? '',
    smtpPort: mailbox.smtpPort ?? 587,
    smtpSecure: mailbox.smtpSecure ?? true,
    smtpEncryption: mailbox.smtpEncryption ?? (mailbox.smtpSecure === false ? 'STARTTLS' : 'SSL'),
    imapHost: mailbox.imapHost ?? '',
    imapPort: mailbox.imapPort ?? 993,
    imapEncryption: mailbox.imapEncryption ?? 'SSL',
    imapUsername: mailbox.imapUsername ?? '',
    imapPassword: '',
    imapAllowSelfSigned: mailbox.imapAllowSelfSigned ?? false,
    dailyLimit: mailbox.dailyLimit ?? 200,
    sendSpeedSeconds: mailbox.sendSpeedSeconds ?? 90,
    warmupEnabled: mailbox.warmupEnabled ?? true,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.patch<{ pendingApproval?: boolean }>(`/email-accounts/${mailbox.id}`, {
        label: form.label,
        protocol: form.protocol,
        emailAddress: form.emailAddress,
        smtpUsername: form.smtpUsername || undefined,
        password: form.password || undefined, // blank = keep current
        smtpHost: form.smtpHost || undefined,
        smtpPort: Number(form.smtpPort),
        smtpSecure: form.smtpEncryption === 'SSL', // keep legacy flag in sync with the mode
        smtpEncryption: form.smtpEncryption,
        imapHost: form.imapHost || undefined,
        imapPort: Number(form.imapPort),
        imapEncryption: form.imapEncryption,
        imapUsername: form.imapUsername || undefined,
        imapPassword: form.imapPassword || undefined,
        imapAllowSelfSigned: form.imapAllowSelfSigned,
        dailyLimit: Number(form.dailyLimit),
        sendSpeedSeconds: Number(form.sendSpeedSeconds),
        warmupEnabled: form.warmupEnabled,
      });
      if (res?.pendingApproval) {
        alert('Login details changed. This mailbox stops sending until an admin approves the new details.');
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Label</label>
          <input
            className="input"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Protocol</label>
          <select
            className="input"
            value={form.protocol}
            onChange={(e) => setForm({ ...form, protocol: e.target.value })}
          >
            <option>SMTP</option>
            <option>IMAP</option>
            <option>POP</option>
          </select>
        </div>
        <div>
          <label className="label">Email address (From)</label>
          <input
            type="email"
            className="input"
            value={form.emailAddress}
            onChange={(e) =>
              setForm({ ...form, emailAddress: e.target.value })
            }
            required
          />
        </div>
        <div>
          <label className="label">SMTP username (optional)</label>
          <input
            className="input"
            value={form.smtpUsername}
            placeholder="Only if login ≠ email, e.g. AWS SES AKIA…"
            onChange={(e) =>
              setForm({ ...form, smtpUsername: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">Password / app-password</label>
          <input
            type="password"
            className="input"
            value={form.password}
            placeholder="Leave blank to keep current"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="label">SMTP host</label>
          <input
            className="input"
            value={form.smtpHost}
            onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
          />
        </div>
        <div>
          <label className="label">SMTP port</label>
          <input
            type="number"
            className="input"
            value={form.smtpPort}
            onChange={(e) =>
              setForm({ ...form, smtpPort: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">SMTP encryption</label>
          <select className="input" value={form.smtpEncryption} onChange={(e) => setForm({ ...form, smtpEncryption: e.target.value })}>
            <option value="SSL">SSL / TLS (usually port 465)</option>
            <option value="STARTTLS">STARTTLS (usually port 587)</option>
            <option value="NONE">None (unencrypted)</option>
          </select>
        </div>
        <div>
          <label className="label">IMAP host</label>
          <input
            className="input"
            value={form.imapHost}
            onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
          />
        </div>
        <div>
          <label className="label">IMAP port</label>
          <input
            type="number"
            className="input"
            value={form.imapPort}
            onChange={(e) =>
              setForm({ ...form, imapPort: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">IMAP encryption</label>
          <select className="input" value={form.imapEncryption} onChange={(e) => setForm({ ...form, imapEncryption: e.target.value })}>
            <option value="SSL">SSL / TLS (usually port 993)</option>
            <option value="STARTTLS">STARTTLS (usually port 143)</option>
            <option value="NONE">None (unencrypted)</option>
          </select>
        </div>
        <div>
          <label className="label">IMAP username (optional)</label>
          <input
            className="input"
            value={form.imapUsername}
            placeholder="Defaults to email; set if mail host differs"
            onChange={(e) =>
              setForm({ ...form, imapUsername: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">IMAP password (optional)</label>
          <input
            type="password"
            className="input"
            value={form.imapPassword}
            placeholder="Leave blank to keep current"
            onChange={(e) =>
              setForm({ ...form, imapPassword: e.target.value })
            }
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.imapAllowSelfSigned}
              onChange={(e) =>
                setForm({ ...form, imapAllowSelfSigned: e.target.checked })
              }
            />
            Allow self-signed IMAP cert
          </label>
        </div>
        <div>
          <label className="label">Daily limit</label>
          <input
            type="number"
            className="input"
            value={form.dailyLimit}
            onChange={(e) =>
              setForm({ ...form, dailyLimit: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">Send speed (seconds between sends)</label>
          <input
            type="number"
            className="input"
            value={form.sendSpeedSeconds}
            onChange={(e) =>
              setForm({ ...form, sendSpeedSeconds: Number(e.target.value) })
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Encryption is now chosen via the "SMTP encryption" dropdown above. */}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.warmupEnabled}
            onChange={(e) =>
              setForm({ ...form, warmupEnabled: e.target.checked })
            }
          />
          Warm-up enabled
        </label>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function SendTestForm({
  mailbox,
  onClose,
}: {
  mailbox: Mailbox;
  onClose: () => void;
}) {
  const [to, setTo] = useState(mailbox.emailAddress);
  const [subject, setSubject] = useState('AEO test email');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; detail: string } | null>(
    null,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ sent: boolean; detail: string }>(
        `/email-accounts/${mailbox.id}/test-email`,
        { to, subject: subject || undefined, body: body || undefined },
      );
      setResult(res);
    } catch (err) {
      setResult({
        sent: false,
        detail: err instanceof Error ? err.message : 'Failed',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-500">
        Sends a real email from <strong>{mailbox.emailAddress}</strong>. Defaults
        to itself (a send-to-self deliverability check).
      </p>
      <div>
        <label className="label">Send to *</label>
        <input
          type="email"
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label">Subject</label>
        <input
          className="input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Message (optional)</label>
        <textarea
          className="input min-h-24"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave blank to send a default test body."
        />
      </div>
      {result && (
        <p
          className={`text-sm ${
            result.sent ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {result.detail}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={busy}
        >
          Close
        </button>
        <button className="btn-primary flex-1" disabled={busy}>
          {busy ? 'Sending…' : 'Send test email'}
        </button>
      </div>
    </form>
  );
}

function AuthStatus({ result }: { result: AuthResult }) {
  if (result.loading)
    return <div className="mt-1 text-xs text-slate-400">Checking DNS…</div>;
  if (result.error)
    return <div className="mt-1 text-xs text-rose-600">DNS check failed.</div>;

  const badge = (label: string, ok: boolean, extra = '') => (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
      }`}
    >
      {label} {ok ? '✓' : '✗'}
      {extra}
    </span>
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {badge('SPF', !!result.spf?.found)}
      {badge(
        'DKIM',
        !!result.dkim?.found,
        result.dkim?.selector ? ` (${result.dkim.selector})` : '',
      )}
      {badge('DMARC', !!result.dmarc?.found)}
      <span className="text-xs text-slate-400">
        score {result.score ?? 0}/100
      </span>
    </div>
  );
}
