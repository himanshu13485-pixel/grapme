'use client';

import { useEffect, useMemo, useState, FormEvent, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, StatusBadge, Tabs } from '@/components/ui';
import { ContactsManager } from '@/components/ContactsManager';
import { TemplatesManager } from '@/components/TemplatesManager';
import { CampaignsManager } from '@/components/CampaignsManager';
import { MailboxesManager } from '@/components/MailboxesManager';

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

function addBusinessDays(base: Date, n: number): Date {
  const d = new Date(base);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface StageRow {
  label: string;
  estStart: Date;
  estEnd: Date;
  state: 'done' | 'current' | 'upcoming';
}

/** Projected per-stage timeline for a cohort (Initial + each follow-up), using
 *  each stage's own waitDays cumulatively. */
function buildSchedule(
  cfg: {
    stageIntervalDays: number;
    batchWindowDays: number;
    followUpCount: number;
    sequenceSteps: SeqStep[];
  },
  startDateStr: string,
): StageRow[] {
  const waitFor = (stage: number) =>
    cfg.sequenceSteps.find((x) => x.stageOrder === stage)?.waitDays ??
    cfg.stageIntervalDays;
  const today = new Date();
  const rows: StageRow[] = [];
  let cursor = new Date(startDateStr); // stage-0 start
  for (let s = 0; s <= cfg.followUpCount; s++) {
    if (s > 0) cursor = addBusinessDays(cursor, waitFor(s));
    const estStart = new Date(cursor);
    const estEnd = addBusinessDays(estStart, Math.max(0, cfg.batchWindowDays - 1));
    const state =
      today > estEnd ? 'done' : today >= estStart ? 'current' : 'upcoming';
    rows.push({ label: s === 0 ? 'Initial' : `Follow-up ${s}`, estStart, estEnd, state });
  }
  return rows;
}

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
interface CohortStat {
  id: string;
  label: string;
  monthIndex: number;
  status: string;
  startDate: string;
  endedAt?: string | null;
  nextSendAt?: string | null;
  estEndAt?: string | null;
  total: number;
  active: number;
  due: number;
  replied: number;
  completed: number;
  stopped: number;
  sent: number;
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

  function flash(m: string) {
    setNotice(m);
    setTimeout(() => setNotice(''), 4000);
  }

  function load() {
    api.get<Client>(`/clients/${id}`).then(setClient).catch(() => {});
    api.get<CohortStat[]>(`/clients/${id}/cohorts/stats`).then(setCohorts).catch(() => {});
  }
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
        ]}
      />

      {tab === 'mailboxes' && <MailboxesManager clientId={client.id} />}
      {tab === 'rotation' && (
        <MailboxGroup client={client} allMailboxes={allMailboxes} onChanged={() => { load(); flash('Mailbox group updated.'); }} />
      )}
      {tab === 'sequence' && (
        <SequenceEditor client={client} templates={templates} onChanged={() => { load(); flash('Sequence saved.'); }} />
      )}
      {tab === 'cohorts' && (
        <Cohorts client={client} cohorts={cohorts} lists={lists} onChanged={() => { load(); flash('Cohort uploaded & enrolled.'); }} />
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
  onChanged,
}: {
  client: Client;
  templates: Template[];
  onChanged: () => void;
}) {
  // Each stage carries its template + waitDays (business days after the previous
  // stage). Index 0 is the initial email (sends immediately, no wait).
  type Row = { templateId: string; waitDays: number };
  const initialRows = useMemo<Row[]>(() => {
    const len = Math.max(client.followUpCount + 1, 1);
    const arr: Row[] = Array.from({ length: len }, () => ({
      templateId: '',
      waitDays: client.stageIntervalDays,
    }));
    client.sequenceSteps.forEach((s) => {
      if (s.stageOrder < len)
        arr[s.stageOrder] = {
          templateId: s.templateId ?? '',
          waitDays: s.waitDays ?? client.stageIntervalDays,
        };
    });
    return arr;
  }, [client.followUpCount, client.sequenceSteps, client.stageIntervalDays]);

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busy, setBusy] = useState(false);

  function setTemplate(i: number, v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, templateId: v } : r)));
  }
  function setWait(i: number, v: number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, waitDays: v } : r)));
  }
  function addFollowUp() {
    setRows((prev) => [...prev, { templateId: '', waitDays: client.stageIntervalDays }]);
  }
  function removeStage(i: number) {
    if (i === 0) return; // initial is required
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    try {
      const steps = rows.map((r, stageOrder) => ({
        stageOrder,
        templateId: r.templateId || undefined,
        waitDays: r.waitDays,
      }));
      await api.put(`/clients/${client.id}/sequence`, { steps });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Pick the template for each stage and how many business days after the previous
        stage it sends. Stage 0 is the initial email. Add as many follow-ups as you like —
        e.g. Initial, FU-1 (+10d, same month), then FU-2…FU-12 (+21d each, monthly).
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
              <span className="w-36 text-xs text-slate-400">sends immediately</span>
            ) : (
              <div className="flex w-36 items-center gap-1">
                <span className="text-xs text-slate-400">+</span>
                <input
                  type="number"
                  className="input w-16"
                  value={row.waitDays}
                  onChange={(e) => setWait(i, Number(e.target.value))}
                  title="Business days after the previous stage"
                />
                <span className="text-xs text-slate-400">days</span>
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

function Cohorts({
  client,
  cohorts,
  lists,
  onChanged,
}: {
  client: Client;
  cohorts: CohortStat[];
  lists: ContactList[];
  onChanged: () => void;
}) {
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Auto-cohort settings (local edit state)
  const [autoEnabled, setAutoEnabled] = useState(client.autoCohortEnabled);
  const [autoListId, setAutoListId] = useState(client.autoCohortListId ?? '');
  const [autoDay, setAutoDay] = useState(client.autoCohortDay);
  const [openCohort, setOpenCohort] = useState<string | null>(null);

  async function upload() {
    if (!listId) return;
    setBusy(true);
    setErr('');
    try {
      await api.post(`/clients/${client.id}/cohorts`, { listId });
      setListId('');
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
    try {
      const r = await api.post<{ sent: number; skipped: number }>(`/cohorts/${cohortId}/send-now`);
      onChanged();
      alert(`Sent ${r.sent}, skipped ${r.skipped} (capped/await).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
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

      {err && <p className="text-sm text-rose-600">{err}</p>}

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
                        <button className="btn-ghost text-xs text-brand-600" onClick={() => sendNow(c.id)}>Send now</button>
                        <button className="btn-ghost text-xs" onClick={() => lifecycle(c.id, 'pause')}>Pause</button>
                      </>
                    )}
                    {c.status === 'PAUSED' && (
                      <button className="btn-ghost text-xs text-emerald-600" onClick={() => lifecycle(c.id, 'resume')}>Resume</button>
                    )}
                    {c.status !== 'STOPPED' && c.status !== 'COMPLETED' && (
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => lifecycle(c.id, 'stop')}>Stop</button>
                    )}
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => deleteCohort(c.id)}>Delete</button>
                  </td>
                </tr>
                {openCohort === c.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={12} className="px-6 py-4">
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
                          {buildSchedule(client, c.startDate).map((s) => (
                            <tr key={s.label} className="border-t border-slate-100">
                              <td className="py-1 pr-6 font-medium text-slate-700">{s.label}</td>
                              <td className="py-1 pr-6 text-slate-600">{fmtDay(s.estStart)}</td>
                              <td className="py-1 pr-6 text-slate-600">{fmtDay(s.estEnd)}</td>
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
