'use client';

import { useEffect, useMemo, useState, FormEvent, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { PageHeader, EmptyState, StatusBadge, Tabs, Modal } from '@/components/ui';
import { ContactsManager } from '@/components/ContactsManager';
import { TemplatesManager } from '@/components/TemplatesManager';
import { CampaignsManager } from '@/components/CampaignsManager';
import { MailboxesManager } from '@/components/MailboxesManager';
import { MailboxManager } from '@/components/MailboxManager';

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface Mailbox {
  id: string;
  label: string;
  emailAddress: string;
  status: string;
  rotationOrder?: number;
}
interface SeqStep {
  id: string;
  stageOrder: number;
  templateId?: string;
  waitDays?: number;
  monthOffset?: number;
}
interface Client {
  id: string;
  name: string;
  plan: string;
  status: string;
  monthlyQuota: number;
  dailyBatchSize: number;
  batchWindowDays: number;
  stageIntervalDays: number;
  followUpCount: number;
  weekdaysOnly: boolean;
  sendWindowStart: number;
  sendWindowEnd: number;
  stageIntervalJitterDays: number;
  autoCohortEnabled: boolean;
  autoCohortListId?: string;
  autoCohortDay: number;
  contactPerson?: string;
  email?: string;
  reportDaily: boolean;
  reportWeekly: boolean;
  reportMonthly: boolean;
  reportHour: number;
  mailboxes: Mailbox[];
  sequenceSteps: SeqStep[];
  _count?: {
    cohorts: number;
    enrollments: number;
    contacts: number;
    contactLists: number;
    templates: number;
    campaigns: number;
  };
}
interface Template { id: string; name: string }
interface ContactList { id: string; name: string; _count?: { members: number } }
interface ScheduleItem {
  stage: string;
  estStart: string;
  estEnd: string;
  state: 'done' | 'current' | 'upcoming';
}
interface CohortStat {
  id: string;
  label: string;
  monthIndex: number;
  status: string;
  startDate: string;
  endedAt?: string | null;
  nextSendAt?: string | null;
  estEndAt?: string | null;
  schedule: ScheduleItem[];
  total: number;
  active: number;
  due: number;
  replied: number;
  completed: number;
  stopped: number;
  sent: number;
  metrics: CohortMetrics;
}
interface CohortMetrics {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  unsubscribes: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

export default function ClientCockpit() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [allMailboxes, setAllMailboxes] = useState<Mailbox[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [cohorts, setCohorts] = useState<CohortStat[]>([]);
  const [tab, setTab] = useState('mailboxes');
  const [notice, setNotice] = useState('');
  const [inboxUnread, setInboxUnread] = useState(0);

  function flash(m: string) {
    setNotice(m);
    setTimeout(() => setNotice(''), 4000);
  }

  function loadUnread() {
    api
      .get<{ count: number }>(`/mailbox/unread?clientId=${id}`)
      .then((r) => setInboxUnread(r.count))
      .catch(() => {});
  }

  function load() {
    api.get<Client>(`/clients/${id}`).then(setClient).catch(() => {});
    api.get<CohortStat[]>(`/clients/${id}/cohorts/stats`).then(setCohorts).catch(() => {});
    loadUnread();
  }
  useEffect(() => {
    // Opening the Inbox marks its replies read, so clear the tab badge.
    if (tab === 'inbox') setInboxUnread(0);
  }, [tab]);
  useEffect(() => {
    if (!id) return;
    load();
    api.get<Mailbox[]>('/email-accounts').then(setAllMailboxes).catch(() => {});
    api.get<Template[]>('/templates').then(setTemplates).catch(() => {});
    api.get<ContactList[]>('/contact-lists').then(setLists).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runEngine() {
    try {
      const r = await api.post<{ sent: number; skipped: number }>('/programs/run-now');
      flash(`Engine ran — sent ${r.sent}, skipped ${r.skipped}.`);
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Run failed');
    }
  }

  if (!client) return <div className="text-slate-400">Loading…</div>;

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link href="/clients" className="text-brand-600 hover:underline">← Clients</Link>
      </div>
      <PageHeader
        title={client.name}
        subtitle={`${client.plan} · ${client.dailyBatchSize}/day · ${client.followUpCount} follow-ups · ${client.weekdaysOnly ? 'weekdays only' : 'all days'}`}
        action={
          <button className="btn-ghost" onClick={runEngine}>
            ▶ Run engine now
          </button>
        }
      />

      {(() => {
        const next = cohorts
          .filter((c) => c.status === 'RUNNING' && c.nextSendAt)
          .map((c) => c.nextSendAt as string)
          .sort()[0];
        return (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
            <span className="text-slate-500">📅 Next scheduled send: </span>
            <strong className="text-slate-700">
              {next
                ? new Date(next).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'nothing scheduled'}
            </strong>
            <span className="ml-3 text-slate-400">
              Send window {hourLabel(client.sendWindowStart)}–{hourLabel(client.sendWindowEnd)} ·{' '}
              {client.weekdaysOnly ? 'weekdays only' : 'all days'}
            </span>
          </div>
        );
      })()}

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'mailboxes', label: 'Mailboxes', count: client.mailboxes.length },
          { key: 'rotation', label: 'Mailbox Group', count: client.mailboxes.length },
          { key: 'sequence', label: 'Sequence', count: client.followUpCount + 1 },
          { key: 'cohorts', label: 'Cohorts', count: cohorts.length },
          { key: 'contacts', label: 'Contacts & Lists', count: client._count?.contacts ?? 0 },
          { key: 'templates', label: 'Templates', count: client._count?.templates ?? 0 },
          { key: 'campaigns', label: 'Campaigns', count: client._count?.campaigns ?? 0 },
          { key: 'inbox', label: 'Inbox & Sent', count: inboxUnread || undefined },
        ]}
      />

      {tab === 'mailboxes' && <MailboxesManager clientId={client.id} />}
      {tab === 'inbox' && <MailboxManager clientId={client.id} />}
      {tab === 'rotation' && (
        <MailboxGroup client={client} allMailboxes={allMailboxes} onChanged={() => { load(); flash('Mailbox group updated.'); }} />
      )}
      {tab === 'sequence' && (
        <SequenceEditor client={client} templates={templates} onChanged={() => { load(); flash('Sequence saved.'); }} />
      )}
      {tab === 'cohorts' && (
        <Cohorts client={client} cohorts={cohorts} lists={lists} templates={templates} onChanged={() => { load(); flash('Cohort uploaded & enrolled.'); }} />
      )}
      {tab === 'contacts' && <ContactsManager clientId={client.id} />}
      {tab === 'templates' && <TemplatesManager clientId={client.id} />}
      {tab === 'campaigns' && <CampaignsManager clientId={client.id} />}
    </div>
  );
}

function MailboxGroup({
  client,
  allMailboxes,
  onChanged,
}: {
  client: Client;
  allMailboxes: Mailbox[];
  onChanged: () => void;
}) {
  const assignedIds = new Set(client.mailboxes.map((m) => m.id));
  const available = allMailboxes.filter((m) => !assignedIds.has(m.id));
  const [pick, setPick] = useState('');
  const [order, setOrder] = useState(client.mailboxes.length + 1);
  const [showCreate, setShowCreate] = useState(false);
  const [cErr, setCErr] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cForm, setCForm] = useState({
    label: '',
    emailAddress: '',
    smtpUsername: '',
    password: '',
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: '',
    imapPort: 993,
    imapUsername: '',
    imapPassword: '',
  });

  async function assign() {
    if (!pick) return;
    await api.post(`/clients/${client.id}/mailboxes`, { mailboxId: pick, rotationOrder: order });
    setPick('');
    onChanged();
  }
  async function remove(mailboxId: string) {
    await api.del(`/clients/${client.id}/mailboxes/${mailboxId}`);
    onChanged();
  }
  async function createMailbox(e: FormEvent) {
    e.preventDefault();
    setCErr('');
    setCBusy(true);
    try {
      await api.post('/email-accounts', {
        ...cForm,
        protocol: 'SMTP',
        smtpPort: Number(cForm.smtpPort),
        imapPort: Number(cForm.imapPort),
        smtpUsername: cForm.smtpUsername || undefined,
        imapHost: cForm.imapHost || undefined,
        imapUsername: cForm.imapUsername || undefined,
        imapPassword: cForm.imapPassword || undefined,
        clientId: client.id,
        rotationOrder: order,
      });
      setShowCreate(false);
      setCForm({
        label: '', emailAddress: '', smtpUsername: '', password: '',
        smtpHost: '', smtpPort: 465, smtpSecure: true,
        imapHost: '', imapPort: 993, imapUsername: '', imapPassword: '',
      });
      onChanged();
    } catch (err) {
      setCErr(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Sends rotate across these mailboxes in rotation order, skipping any that hit their daily cap.
      </p>

      {client.mailboxes.length === 0 ? (
        <EmptyState message="No mailboxes in this group yet. Assign one below." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Label</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {[...client.mailboxes]
                .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))
                .map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-5 py-3 text-slate-500">{m.rotationOrder ?? 0}</td>
                    <td className="px-5 py-3 font-medium">{m.label}</td>
                    <td className="px-5 py-3 text-slate-500">{m.emailAddress}</td>
                    <td className="px-5 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-5 py-3 text-right">
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => remove(m.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="label">Add mailbox to group</label>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select a mailbox…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>{m.label} ({m.emailAddress})</option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="label">Order</label>
          <input type="number" className="input" value={order} onChange={(e) => setOrder(Number(e.target.value))} />
        </div>
        <button className="btn-primary" onClick={assign} disabled={!pick}>Add</button>
      </div>

      {/* Create a brand-new mailbox already allocated to this client */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">
            Create a new mailbox for this client
          </div>
          <button className="btn-ghost text-xs" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : '+ New mailbox'}
          </button>
        </div>
        {showCreate && (
          <form onSubmit={createMailbox} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Label *</label>
                <input className="input" value={cForm.label} onChange={(e) => setCForm({ ...cForm, label: e.target.value })} required />
              </div>
              <div>
                <label className="label">Email address (From) *</label>
                <input type="email" className="input" value={cForm.emailAddress} onChange={(e) => setCForm({ ...cForm, emailAddress: e.target.value })} required />
              </div>
              <div>
                <label className="label">SMTP username (optional)</label>
                <input className="input" placeholder="e.g. AWS SES AKIA…" value={cForm.smtpUsername} onChange={(e) => setCForm({ ...cForm, smtpUsername: e.target.value })} />
              </div>
              <div>
                <label className="label">Password / app-password *</label>
                <input type="password" className="input" value={cForm.password} onChange={(e) => setCForm({ ...cForm, password: e.target.value })} required />
              </div>
              <div>
                <label className="label">SMTP host</label>
                <input className="input" value={cForm.smtpHost} onChange={(e) => setCForm({ ...cForm, smtpHost: e.target.value })} placeholder="email-smtp.us-east-1.amazonaws.com" />
              </div>
              <div>
                <label className="label">SMTP port</label>
                <input type="number" className="input" value={cForm.smtpPort} onChange={(e) => setCForm({ ...cForm, smtpPort: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">IMAP host (for receiving)</label>
                <input className="input" value={cForm.imapHost} onChange={(e) => setCForm({ ...cForm, imapHost: e.target.value })} placeholder="mail.yourdomain.com" />
              </div>
              <div>
                <label className="label">IMAP password (optional)</label>
                <input type="password" className="input" placeholder="If receiving host differs" value={cForm.imapPassword} onChange={(e) => setCForm({ ...cForm, imapPassword: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={cForm.smtpSecure} onChange={(e) => setCForm({ ...cForm, smtpSecure: e.target.checked })} />
              SMTP TLS/SSL (port 465)
            </label>
            {cErr && <p className="text-sm text-rose-600">{cErr}</p>}
            <button className="btn-primary" disabled={cBusy}>
              {cBusy ? 'Creating…' : 'Create & allocate to this client'}
            </button>
            <p className="text-xs text-slate-400">
              New mailboxes start PENDING and need admin approval before the engine uses them.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function SequenceEditor({
  client,
  templates,
  cohortId,
  onChanged,
}: {
  client: Client;
  templates: Template[];
  cohortId?: string; // when set, edits that cohort's OWN sequence
  onChanged: () => void;
}) {
  // Each stage = a template + the cohort-month it sends in. Index 0 is the
  // Initial (Month 1, sends immediately). Plan purely in months.
  type Row = { templateId: string; monthOffset: number };

  function rowsFromSteps(steps: SeqStep[]): Row[] {
    const maxStage = steps.reduce(
      (m, s) => Math.max(m, s.stageOrder),
      Math.max(client.followUpCount, 0),
    );
    const len = Math.max(maxStage + 1, 1);
    const arr: Row[] = Array.from({ length: len }, (_, i) => ({
      templateId: '',
      monthOffset: i === 0 ? 1 : Math.max(1, i),
    }));
    steps.forEach((s) => {
      if (s.stageOrder < len)
        arr[s.stageOrder] = {
          templateId: s.templateId ?? '',
          monthOffset:
            s.monthOffset ?? (s.stageOrder === 0 ? 1 : Math.max(1, s.stageOrder)),
        };
    });
    return arr;
  }

  const [rows, setRows] = useState<Row[]>(() =>
    cohortId ? [] : rowsFromSteps(client.sequenceSteps),
  );
  const [busy, setBusy] = useState(false);

  // In cohort mode, load that cohort's own sequence (falls back to default).
  useEffect(() => {
    if (!cohortId) {
      setRows(rowsFromSteps(client.sequenceSteps));
      return;
    }
    api
      .get<SeqStep[]>(`/cohorts/${cohortId}/sequence`)
      .then((steps) => setRows(rowsFromSteps(steps)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortId, client.sequenceSteps, client.followUpCount]);

  function setTemplate(i: number, v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, templateId: v } : r)));
  }
  function setMonth(i: number, v: number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, monthOffset: v } : r)));
  }
  function addFollowUp() {
    setRows((prev) => {
      const lastMonth = prev[prev.length - 1]?.monthOffset ?? 1;
      return [...prev, { templateId: '', monthOffset: lastMonth + 1 }];
    });
  }
  function removeStage(i: number) {
    if (i === 0) return; // initial is required
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Effective (non-decreasing) month per stage — mirrors the server's clamp.
  const effMonths = useMemo(() => {
    let prev = 1;
    return rows.map((r, i) => {
      const m = i === 0 ? 1 : Math.max(prev, r.monthOffset);
      prev = m;
      return m;
    });
  }, [rows]);

  async function save() {
    setBusy(true);
    try {
      const steps = rows.map((r, stageOrder) => ({
        stageOrder,
        templateId: r.templateId || undefined,
        monthOffset: stageOrder === 0 ? 1 : r.monthOffset,
      }));
      const url = cohortId
        ? `/cohorts/${cohortId}/sequence`
        : `/clients/${client.id}/sequence`;
      await api.put(url, { steps });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const months = [...new Set(effMonths)].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Pick the template for each touch and the <strong>cohort-month</strong> it sends in.
        Month 1 is the cohort&apos;s first month (Initial sends immediately). Put extra touches
        in later months for follow-ups.{' '}
        {cohortId ? (
          <strong>This is this cohort&apos;s own sequence.</strong>
        ) : (
          <strong>Default plan — new cohorts start from this.</strong>
        )}
      </p>
      <div className="card divide-y divide-slate-100">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <div className="w-24 text-sm font-medium text-slate-700">
              {i === 0 ? 'Initial' : `Follow-up ${i}`}
            </div>
            <select
              className="input flex-1"
              value={row.templateId}
              onChange={(e) => setTemplate(i, e.target.value)}
            >
              <option value="">— no template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {i === 0 ? (
              <span className="w-40 text-xs text-slate-400">Month 1 · sends immediately</span>
            ) : (
              <div className="flex w-40 items-center gap-1">
                <span className="text-xs text-slate-400">Send in</span>
                <select
                  className="input w-28"
                  value={row.monthOffset}
                  onChange={(e) => setMonth(i, Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, m) => (
                    <option key={m + 1} value={m + 1}>Month {m + 1}</option>
                  ))}
                </select>
              </div>
            )}
            {i === 0 ? (
              <span className="w-16 text-xs text-slate-300">required</span>
            ) : (
              <button
                className="w-16 text-xs text-rose-500 hover:underline"
                onClick={() => removeStage(i)}
                type="button"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Per-cohort plan, grouped by month */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
        <div className="mb-1 font-medium text-slate-600">Per-cohort plan by month</div>
        {months.map((m) => (
          <div key={m} className="text-slate-500">
            <span className="font-medium text-slate-700">Month {m}:</span>{' '}
            {rows
              .map((_, i) => (effMonths[i] === m ? (i === 0 ? 'Initial' : `Follow-up ${i}`) : null))
              .filter(Boolean)
              .join(', ')}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-ghost" type="button" onClick={addFollowUp}>
          + Add follow-up
        </button>
        <span className="text-xs text-slate-400">
          {rows.length - 1} follow-up{rows.length - 1 === 1 ? '' : 's'} after the initial
        </span>
      </div>

      {templates.length === 0 && (
        <p className="text-xs text-slate-400">No templates yet — create them on the Templates page first.</p>
      )}
      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save sequence'}
      </button>
    </div>
  );
}

function ReportSettings({ client, onChanged }: { client: Client; onChanged: () => void }) {
  const [daily, setDaily] = useState(client.reportDaily);
  const [weekly, setWeekly] = useState(client.reportWeekly);
  const [monthly, setMonthly] = useState(client.reportMonthly);
  const [hour, setHour] = useState(client.reportHour);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [fromAddr, setFromAddr] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ from: string | null }>('/reports/sender')
      .then((r) => setFromAddr(r.from))
      .catch(() => setFromAddr(null));
  }, []);

  async function save() {
    setBusy(true);
    setNote('');
    try {
      await api.patch(`/clients/${client.id}`, {
        reportDaily: daily,
        reportWeekly: weekly,
        reportMonthly: monthly,
        reportHour: Number(hour),
      });
      setNote('Report schedule saved.');
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendNow(period: 'daily' | 'weekly' | 'monthly') {
    setBusy(true);
    setNote('');
    try {
      const r = await api.post<{ sent: boolean; detail: string }>(
        `/clients/${client.id}/report?period=${period}`,
      );
      setNote(r.detail);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const hr = (h: number) => {
    const ap = h < 12 ? 'AM' : 'PM';
    const x = h % 12 === 0 ? 12 : h % 12;
    return `${x}:00 ${ap}`;
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">📧 Email reports to client</h3>
        <span className="text-xs text-slate-400">
          {client.email ? `Recipient: ${client.email}` : 'No client email set — add it on the client to enable.'}
        </span>
      </div>
      <p className="text-xs text-slate-400">
        A professional performance report (emails sent, opens, clicks, replies received,
        bounces) is emailed <strong>from the admin address</strong> to the client&apos;s
        contact email at the chosen time.
      </p>
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-xs">
        <span>
          <span className="text-slate-400">Sends from: </span>
          {fromAddr === undefined ? (
            <span className="text-slate-400">checking…</span>
          ) : fromAddr ? (
            <span className="font-medium text-slate-700">{fromAddr}</span>
          ) : (
            <span className="font-medium text-rose-600">not set</span>
          )}
        </span>
        <span>
          <span className="text-slate-400">Sends to: </span>
          {client.email ? (
            <span className="font-medium text-slate-700">{client.email}</span>
          ) : (
            <span className="font-medium text-rose-600">no contact email set</span>
          )}
        </span>
        <span className="text-slate-400">
          Set the report sender on the <strong>Mailboxes</strong> page.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
          Daily
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
          Weekly (Mon)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
          Monthly (1st)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Send at</span>
          <select className="input w-28 py-1" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hr(h)}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary text-xs" onClick={save} disabled={busy}>
          Save schedule
        </button>
        <button
          className="btn-primary text-xs"
          onClick={() => sendNow('daily')}
          disabled={busy || !client.email}
          title="Send a report right now to test"
        >
          <span className={busy ? 'inline-block animate-spin' : ''}>{busy ? '⟳' : '📤'}</span>{' '}
          {busy ? 'Sending…' : 'Send test now'}
        </button>
      </div>
      {note && (
        <p className={`text-xs ${note.toLowerCase().includes('fail') ? 'text-rose-600' : 'text-emerald-600'}`}>
          {note}
        </p>
      )}
    </div>
  );
}

function Cohorts({
  client,
  cohorts,
  lists,
  templates,
  onChanged,
}: {
  client: Client;
  cohorts: CohortStat[];
  lists: ContactList[];
  templates: Template[];
  onChanged: () => void;
}) {
  const [listId, setListId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Auto-cohort settings (local edit state)
  const [autoEnabled, setAutoEnabled] = useState(client.autoCohortEnabled);
  const [autoListId, setAutoListId] = useState(client.autoCohortListId ?? '');
  const [autoDay, setAutoDay] = useState(client.autoCohortDay);
  const [openCohort, setOpenCohort] = useState<string | null>(null);
  const [seqCohort, setSeqCohort] = useState<CohortStat | null>(null);
  const [reportCohort, setReportCohort] = useState('ALL');

  async function upload() {
    if (!listId) return;
    setBusy(true);
    setErr('');
    try {
      await api.post(`/clients/${client.id}/cohorts`, {
        listId,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
      });
      setListId('');
      setStartDate('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveAuto() {
    setErr('');
    try {
      await api.patch(`/clients/${client.id}`, {
        autoCohortEnabled: autoEnabled,
        autoCohortListId: autoListId || undefined,
        autoCohortDay: Number(autoDay),
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function createFromSourceNow() {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/clients/${client.id}/auto-cohort/run`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(cohortId: string, action: 'pause' | 'resume' | 'stop') {
    if (action === 'stop' && !confirm('Stop this cohort permanently? Remaining contacts will not be emailed.')) return;
    try {
      await api.post(`/cohorts/${cohortId}/${action}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function sendNow(cohortId: string) {
    if (!confirm('Send the current step to all active contacts in this cohort now? (Daily mailbox caps still apply.)')) return;
    setSendingId(cohortId);
    try {
      const r = await api.post<{ sent: number; skipped: number }>(`/cohorts/${cohortId}/send-now`);
      onChanged();
      alert(`Sent ${r.sent}, skipped ${r.skipped} (capped/await).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSendingId(null);
    }
  }

  async function deleteCohort(cohortId: string) {
    if (!confirm('Delete this cohort and all its enrollments permanently?')) return;
    try {
      await api.del(`/cohorts/${cohortId}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  // Unambiguous date — "Aug 10, 2026" (avoids M/D vs D/M confusion).
  const fmtDate = (s?: string | null) =>
    s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtDateTime = (s?: string | null) =>
    s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-4">
      {/* Manual upload from any list */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="label">Manual: upload a cohort from any contact list</label>
          <select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Select a contact list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}{typeof l._count?.members === 'number' ? ` (${l._count.members})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Start date (optional)</label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="Leave blank to start now; set a future date to upload in advance"
          />
        </div>
        <button className="btn-primary" onClick={upload} disabled={!listId || busy}>
          {busy ? 'Enrolling…' : 'Upload & enroll'}
        </button>
      </div>

      {/* Auto-cohort settings + manual trigger from the source list */}
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Automatic monthly cohort</h3>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={async (e) => {
                const v = e.target.checked;
                setAutoEnabled(v);
                try {
                  await api.patch(`/clients/${client.id}`, {
                    autoCohortEnabled: v,
                    autoCohortListId: autoListId || undefined,
                    autoCohortDay: Number(autoDay),
                  });
                  onChanged();
                } catch (err) {
                  setErr(err instanceof Error ? err.message : 'Failed to save');
                  setAutoEnabled(!v); // revert on failure
                }
              }}
            />
            Enabled {autoEnabled && <span className="text-xs text-emerald-600">(saved)</span>}
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Each month the system auto-creates a cohort from the source list, taking only fresh
          (not-yet-enrolled) contacts, up to {client.monthlyQuota}.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="label">Source list</label>
            <select className="input" value={autoListId} onChange={(e) => setAutoListId(e.target.value)}>
              <option value="">Select a contact list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{typeof l._count?.members === 'number' ? ` (${l._count.members})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="label">Day of month</label>
            <input type="number" className="input" value={autoDay} onChange={(e) => setAutoDay(Number(e.target.value))} />
          </div>
          <button className="btn-primary" onClick={saveAuto}>Save</button>
          <button className="btn-ghost" onClick={createFromSourceNow} disabled={busy || !autoListId}>
            Create next now
          </button>
        </div>
      </div>

      <ReportSettings client={client} onChanged={onChanged} />

      {err && <p className="text-sm text-rose-600">{err}</p>}

      {cohorts.length > 0 && (() => {
        // Totals across every cohort (rates recomputed from totals).
        const totals = cohorts.reduce(
          (a, c) => ({
            sent: a.sent + c.metrics.sent,
            opens: a.opens + c.metrics.opens,
            clicks: a.clicks + c.metrics.clicks,
            replies: a.replies + c.metrics.replies,
            bounces: a.bounces + c.metrics.bounces,
            unsubscribes: a.unsubscribes + c.metrics.unsubscribes,
          }),
          { sent: 0, opens: 0, clicks: 0, replies: 0, bounces: 0, unsubscribes: 0 },
        );
        // The selected view: one cohort, or all combined.
        const selected =
          reportCohort === 'ALL'
            ? null
            : cohorts.find((c) => c.id === reportCohort) ?? null;
        const m = selected ? selected.metrics : totals;
        const pct = (n: number) => (m.sent ? Math.round((n / m.sent) * 1000) / 10 : 0);
        const delivPct = (s: number, b: number) => (s + b ? Math.round((s / (s + b)) * 1000) / 10 : 0);

        function exportCsv() {
          const headers = [
            'Cohort', 'Month', 'Status', 'Sent', 'Delivered', 'Delivery %',
            'Opens', 'Open %', 'Clicks', 'Click %', 'Replies', 'Reply %',
            'Bounces', 'Bounce %', 'Unsub',
          ];
          const rowFor = (c: CohortStat) => [
            c.label, c.monthIndex, c.status, c.metrics.sent, c.metrics.delivered,
            c.metrics.deliveryRate, c.metrics.opens, c.metrics.openRate,
            c.metrics.clicks, c.metrics.clickRate, c.metrics.replies,
            c.metrics.replyRate, c.metrics.bounces, c.metrics.bounceRate,
            c.metrics.unsubscribes,
          ];
          const safe = client.name.replace(/[^\w-]+/g, '_');
          if (selected) {
            downloadCsv(`${safe}_${selected.label.replace(/[^\w-]+/g, '_')}_report`, headers, [rowFor(selected)]);
            return;
          }
          const rows: (string | number)[][] = cohorts.map(rowFor);
          rows.push([
            'ALL COHORTS', '', '', totals.sent, totals.sent,
            delivPct(totals.sent, totals.bounces), totals.opens, pct(totals.opens),
            totals.clicks, pct(totals.clicks), totals.replies, pct(totals.replies),
            totals.bounces, pct(totals.bounces), totals.unsubscribes,
          ]);
          downloadCsv(`${safe}_cohort_report`, headers, rows);
        }

        return (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {selected ? `Report — #${selected.monthIndex} ${selected.label}` : 'Client report — all cohorts'}
              </h3>
              <div className="flex items-center gap-2">
                <select
                  className="input py-1 text-xs"
                  value={reportCohort}
                  onChange={(e) => setReportCohort(e.target.value)}
                >
                  <option value="ALL">All cohorts (total)</option>
                  {cohorts.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.monthIndex} {c.label}
                    </option>
                  ))}
                </select>
                <button className="btn-ghost text-xs" onClick={exportCsv}>
                  ⭳ Export CSV
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
              {([
                ['Sent', m.sent],
                ['Delivered', m.sent],
                ['Delivery %', `${delivPct(m.sent, m.bounces)}%`],
                ['Opens', m.opens],
                ['Open %', `${pct(m.opens)}%`],
                ['Clicks', m.clicks],
                ['Click %', `${pct(m.clicks)}%`],
                ['Replies', m.replies],
                ['Reply %', `${pct(m.replies)}%`],
                ['Bounces', m.bounces],
                ['Bounce %', `${pct(m.bounces)}%`],
                ['Unsub', m.unsubscribes],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-0.5 text-base font-semibold text-brand-700">{value}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {cohorts.length === 0 ? (
        <EmptyState message="No cohorts yet. Upload a list, or enable auto-cohort above." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Source list</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Contacts</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Replied</th>
                <th className="px-4 py-3">Done</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Next send</th>
                <th className="px-4 py-3">Est. end</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <Fragment key={c.id}>
                <tr className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={() => setOpenCohort(openCohort === c.id ? null : c.id)}
                      title="Show follow-up schedule"
                    >
                      {openCohort === c.id ? '▾' : '▸'} #{c.monthIndex}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.label}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{c.total}</td>
                  <td className="px-4 py-3 text-slate-600">{c.sent}</td>
                  <td className="px-4 py-3 text-amber-600">{c.due}</td>
                  <td className="px-4 py-3 text-emerald-600">{c.replied}</td>
                  <td className="px-4 py-3 text-slate-500">{c.completed}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtDate(c.startDate)}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {c.status === 'RUNNING' ? fmtDateTime(c.nextSendAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {c.status === 'STOPPED' ? `ended ${fmtDate(c.endedAt)}` : fmtDate(c.estEndAt)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.status === 'RUNNING' && (
                      <>
                        <button
                          className="btn-ghost text-xs text-brand-600 disabled:opacity-50"
                          onClick={() => sendNow(c.id)}
                          disabled={sendingId === c.id}
                        >
                          {sendingId === c.id ? (
                            <><span className="inline-block animate-spin">⟳</span> Sending…</>
                          ) : (
                            'Send now'
                          )}
                        </button>
                        <button className="btn-ghost text-xs" onClick={() => lifecycle(c.id, 'pause')}>Pause</button>
                      </>
                    )}
                    {c.status === 'PAUSED' && (
                      <button className="btn-ghost text-xs text-emerald-600" onClick={() => lifecycle(c.id, 'resume')}>Resume</button>
                    )}
                    {c.status !== 'STOPPED' && c.status !== 'COMPLETED' && (
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => lifecycle(c.id, 'stop')}>Stop</button>
                    )}
                    <button className="btn-ghost text-xs" onClick={() => setSeqCohort(c)}>Sequence</button>
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => deleteCohort(c.id)}>Delete</button>
                  </td>
                </tr>
                {openCohort === c.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={12} className="px-6 py-4">
                      <div className="mb-2 text-xs font-medium text-slate-500">
                        Sending report
                      </div>
                      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
                        {([
                          ['Sent', c.metrics.sent],
                          ['Delivered', c.metrics.delivered],
                          ['Delivery %', `${c.metrics.deliveryRate}%`],
                          ['Opens', c.metrics.opens],
                          ['Open %', `${c.metrics.openRate}%`],
                          ['Clicks', c.metrics.clicks],
                          ['Click %', `${c.metrics.clickRate}%`],
                          ['Replies', c.metrics.replies],
                          ['Reply %', `${c.metrics.replyRate}%`],
                          ['Bounces', c.metrics.bounces],
                          ['Bounce %', `${c.metrics.bounceRate}%`],
                          ['Unsub', c.metrics.unsubscribes],
                        ] as [string, string | number][]).map(([label, value]) => (
                          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
                            <div className="mt-0.5 text-base font-semibold text-slate-800">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mb-2 text-xs font-medium text-slate-500">
                        Projected follow-up schedule (estimated — actual times jitter ±{client.stageIntervalJitterDays} days)
                      </div>
                      <table className="w-full max-w-2xl text-xs">
                        <thead className="text-left uppercase text-slate-400">
                          <tr>
                            <th className="py-1 pr-6">Stage</th>
                            <th className="py-1 pr-6">Est. start</th>
                            <th className="py-1 pr-6">Est. end</th>
                            <th className="py-1">State</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.schedule.map((s) => (
                            <tr key={s.stage} className="border-t border-slate-100">
                              <td className="py-1 pr-6 font-medium text-slate-700">{s.stage}</td>
                              <td className="py-1 pr-6 text-slate-600">{fmtDay(new Date(s.estStart))}</td>
                              <td className="py-1 pr-6 text-slate-600">{fmtDay(new Date(s.estEnd))}</td>
                              <td className="py-1">
                                <span
                                  className={
                                    s.state === 'done'
                                      ? 'text-slate-400'
                                      : s.state === 'current'
                                        ? 'font-medium text-emerald-600'
                                        : 'text-amber-600'
                                  }
                                >
                                  {s.state === 'done' ? 'done' : s.state === 'current' ? 'in progress' : 'upcoming'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dedicated forward agenda: every upcoming send across running cohorts. */}
      {(() => {
        const items = cohorts
          .filter((c) => c.status === 'RUNNING')
          .flatMap((c) =>
            c.schedule
              .filter((s) => s.state !== 'done')
              .map((s) => ({
                key: c.id + s.stage,
                date: new Date(s.estStart),
                end: new Date(s.estEnd),
                cohort: c,
                stage: s.stage,
                state: s.state,
              })),
          )
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        if (items.length === 0) return null;
        return (
          <div className="mt-8">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              📅 Upcoming scheduled sends — all running cohorts
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Forward agenda of every initial/follow-up wave still to go out, in date order
              (estimated; ±{client.stageIntervalJitterDays} days jitter).
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Est. date</th>
                    <th className="px-4 py-3">Cohort</th>
                    <th className="px-4 py-3">Source list</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Window ends</th>
                    <th className="px-4 py-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.key} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-700">{fmtDay(it.date)}</td>
                      <td className="px-4 py-3 text-slate-500">#{it.cohort.monthIndex}</td>
                      <td className="px-4 py-3 text-slate-500">{it.cohort.label}</td>
                      <td className="px-4 py-3 text-slate-600">{it.stage}</td>
                      <td className="px-4 py-3 text-slate-400">{fmtDay(it.end)}</td>
                      <td className="px-4 py-3">
                        <span className={it.state === 'current' ? 'font-medium text-emerald-600' : 'text-amber-600'}>
                          {it.state === 'current' ? 'in progress' : 'upcoming'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <Modal
        open={!!seqCohort}
        onClose={() => setSeqCohort(null)}
        title={seqCohort ? `Sequence · #${seqCohort.monthIndex} ${seqCohort.label}` : 'Sequence'}
        wide
      >
        {seqCohort && (
          <SequenceEditor
            client={client}
            templates={templates}
            cohortId={seqCohort.id}
            onChanged={() => {
              setSeqCohort(null);
              onChanged();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ── Per-client resource tabs (auto-allocated to this client) ── */

interface CContact { id: string; email: string; firstName?: string; lastName?: string; company?: string; status: string }
function ClientContacts({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<CContact[]>([]);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', company: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  function load() { api.get<CContact[]>(`/contacts?clientId=${clientId}`).then(setRows).catch(() => {}); }
  useEffect(load, [clientId]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.email) return;
    setBusy(true); setErr('');
    try {
      await api.post('/contacts', {
        email: form.email,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        company: form.company || undefined,
        clientId,
      });
      setForm({ email: '', firstName: '', lastName: '', company: '' });
      load(); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-5">
        <input className="input sm:col-span-2" placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="input" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        <input className="input" placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <button className="btn-primary" disabled={busy}>Add contact</button>
      </form>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {rows.length === 0 ? (
        <EmptyState message="No contacts for this client yet." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr><th className="px-5 py-3">Email</th><th className="px-5 py-3">Name</th><th className="px-5 py-3">Company</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{c.email}</td>
                  <td className="px-5 py-3 text-slate-500">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-5 py-3 text-slate-500">{c.company ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">Full edit/delete &amp; CSV import live on the global Contacts page (filter by this client).</p>
    </div>
  );
}

interface CList { id: string; name: string; _count?: { members: number } }
function ClientLists({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<CList[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  function load() { api.get<CList[]>(`/contact-lists?clientId=${clientId}`).then(setRows).catch(() => {}); }
  useEffect(load, [clientId]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    setBusy(true);
    try { await api.post('/contact-lists', { name, clientId }); setName(''); load(); onChanged(); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card flex items-end gap-3 p-4">
        <div className="flex-1">
          <label className="label">New list for this client</label>
          <input className="input" placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button className="btn-primary" disabled={busy}>Create list</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState message="No lists for this client yet." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {rows.map((l) => (
            <div key={l.id} className="card p-5">
              <div className="font-medium">{l.name}</div>
              <div className="mt-2 text-2xl font-semibold text-brand-700">
                {l._count?.members ?? 0}
                <span className="ml-1 text-xs font-normal text-slate-400">contacts</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">Manage members on the global Lists page (filter by this client). Use a list in the Cohorts tab to enroll a cohort.</p>
    </div>
  );
}

interface CTemplate { id: string; name: string; subject: string }
function ClientTemplates({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<CTemplate[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', bodyHtml: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  function load() { api.get<CTemplate[]>(`/templates?clientId=${clientId}`).then(setRows).catch(() => {}); }
  useEffect(load, [clientId]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.subject) return;
    setBusy(true); setErr('');
    try {
      await api.post('/templates', { ...form, bodyHtml: form.bodyHtml || '<p></p>', clientId });
      setForm({ name: '', subject: '', bodyHtml: '' });
      load(); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="Template name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" placeholder="Subject *" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
        </div>
        <textarea className="input min-h-24" placeholder="Body (HTML). Use {{first_name}}, {{company}} …" value={form.bodyHtml} onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })} />
        <button className="btn-primary" disabled={busy}>Create template</button>
      </form>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {rows.length === 0 ? (
        <EmptyState message="No templates for this client yet." />
      ) : (
        <div className="card divide-y divide-slate-100">
          {rows.map((t) => (
            <div key={t.id} className="p-4">
              <div className="font-medium">{t.name}</div>
              <div className="text-sm text-slate-500">{t.subject}</div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">These templates appear in the Sequence tab&apos;s dropdowns. Full editing on the global Templates page.</p>
    </div>
  );
}

interface CCampaign { id: string; name: string; status: string; _count?: { steps: number; messages: number } }
function ClientCampaigns({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<CCampaign[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  function load() { api.get<CCampaign[]>(`/campaigns?clientId=${clientId}`).then(setRows).catch(() => {}); }
  useEffect(load, [clientId]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    setBusy(true);
    try { await api.post('/campaigns', { name, clientId }); setName(''); load(); onChanged(); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card flex items-end gap-3 p-4">
        <div className="flex-1">
          <label className="label">New campaign for this client</label>
          <input className="input" placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button className="btn-primary" disabled={busy}>Create draft</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState message="No campaigns for this client yet." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Steps</th><th className="px-5 py-3">Sent</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3 text-slate-500">{c._count?.steps ?? 0}</td>
                  <td className="px-5 py-3 text-slate-500">{c._count?.messages ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">Full campaign builder (steps, schedule, approval) on the global Campaigns page.</p>
    </div>
  );
}
