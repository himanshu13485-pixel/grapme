'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCanDelete, useAuth } from '@/lib/auth';
import { usePlans } from '@/lib/plans';
import { PageHeader, EmptyState, Modal, StatusBadge, Pagination } from '@/components/ui';
import { LiClientPlanFields, LiPlanForm, emptyLiPlan } from '@/components/LiClientPlanFields';
import { LiSubscription, LI_DEFAULTS } from '@/lib/linkedin';

interface Client {
  id: string;
  name: string;
  invoiceNo?: string;
  contactPerson?: string;
  email?: string;
  mobile?: string;
  productCategory?: string;
  serviceType?: string;
  emailEnabled?: boolean;
  linkedInEnabled?: boolean;
  linkedInCreditMetering?: boolean;
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
  validityDays?: number | null;
  validityStartAt?: string | null;
  _count?: { mailboxes: number; cohorts: number; enrollments: number };
  owner?: { id: string; name: string; email: string; contactMobile?: string | null } | null;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState(false);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [q, setQ] = useState('');
  const [invoiceQ, setInvoiceQ] = useState('');
  const [emailQ, setEmailQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;
  const canDelete = useCanDelete();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN';
  const isClient = user?.role === 'CLIENT';
  const { planNames } = usePlans();
  // A client may self-create profiles up to their billable limit.
  const clientCanAdd = isClient && total < (user?.profileLimit ?? 1);

  // Debounce the free-text filters so typing doesn't fire a request per keystroke.
  const [dq, setDq] = useState('');
  const [dEmail, setDEmail] = useState('');
  const [dInvoice, setDInvoice] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => setDEmail(emailQ.trim()), 300);
    return () => clearTimeout(t);
  }, [emailQ]);
  useEffect(() => {
    const t = setTimeout(() => setDInvoice(invoiceQ.trim()), 300);
    return () => clearTimeout(t);
  }, [invoiceQ]);

  const hasFilters =
    !!dq || !!dEmail || !!dInvoice || statusFilter !== 'ALL' || planFilter !== 'ALL';

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (dq) params.set('q', dq);
    if (dEmail) params.set('email', dEmail);
    if (dInvoice && !isClient) params.set('invoice', dInvoice);
    if (statusFilter !== 'ALL') params.set('status', statusFilter.toLowerCase());
    if (planFilter !== 'ALL') params.set('plan', planFilter);
    api
      .get<{ items: Client[]; total: number }>(`/clients/paged?${params.toString()}`)
      .then((r) => {
        setClients(r.items);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, dEmail, dInvoice, statusFilter, planFilter, isClient]);

  // Reset to page 1 whenever the filters change, then (re)fetch.
  useEffect(() => setPage(1), [dq, dEmail, dInvoice, statusFilter, planFilter]);
  useEffect(() => {
    load();
  }, [load]);

  // The sidebar "Set up my workspace" links here with ?new=1 to open the form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setShow(true);
      window.history.replaceState(null, '', '/clients');
    }
  }, []);

  async function deleteClient(c: Client) {
    if (
      !confirm(
        `Delete client "${c.name}"?\n\nThis permanently deletes its COHORTS (and their sequences & enrollments). Mailboxes, contacts, lists, templates and campaigns are kept but unlinked from the client.`,
      )
    )
      return;
    try {
      const r = await api.del<{ deleted?: boolean; pendingApproval?: boolean }>(`/clients/${c.id}`);
      if (r?.pendingApproval) {
        alert('Delete request sent to a super admin for approval.');
        return;
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete client');
    }
  }

  return (
    <div>
      <PageHeader
        title={isClient ? 'My Profiles' : 'Clients Workspace'}
        subtitle={
          isClient
            ? `Each profile runs its own mailbox group, sequence, and monthly cohorts (${total}/${user?.profileLimit ?? 1} used)`
            : 'Each client runs its own mailbox group, sequence, and monthly cohorts'
        }
        action={
          isAdmin || clientCanAdd ? (
            <button className="btn-primary" onClick={() => setShow(true)}>
              {isClient
                ? total === 0
                  ? '+ Set up my workspace'
                  : '+ Add profile'
                : '+ New client'}
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Search by company / plan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <input
            className="input w-56"
            placeholder="Filter by email…"
            value={emailQ}
            onChange={(e) => setEmailQ(e.target.value)}
          />
          {!isClient && (
            <input
              className="input w-48"
              placeholder="Filter by invoice no.…"
              value={invoiceQ}
              onChange={(e) => setInvoiceQ(e.target.value)}
            />
          )}
          {!isClient && (
            <select
              className="input w-36"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          )}
          {!isClient && (
            <select
              className="input w-40"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
            >
              <option value="ALL">All plans</option>
              {planNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-sm text-slate-400">{total} total</span>
        </div>
        {loaded && total === 0 ? (
          <EmptyState
            message={
              hasFilters
                ? 'No clients match your search.'
                : isClient
                  ? 'No workspace yet — set one up to start your outreach.'
                  : 'No clients yet. Create one to set up its mailbox group and outreach.'
            }
          />
        ) : (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="card p-5 transition hover:border-brand-300 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium text-slate-800">{c.name}</div>
                <StatusBadge status={(c.status ?? 'active').toLowerCase() === 'active' ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              {(c.email || c.owner?.email) && (
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {c.email || c.owner?.email}
                </div>
              )}
              <div className="mt-1 text-xs text-slate-400">
                {c.plan}
                {c.invoiceNo && <span> · Invoice {c.invoiceNo}</span>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Mailboxes" value={c._count?.mailboxes ?? 0} />
                <Stat label="Cohorts" value={c._count?.cohorts ?? 0} />
                <Stat label="Contacts" value={c._count?.enrollments ?? 0} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>{c.dailyBatchSize}/day · {c.followUpCount} follow-ups · {c.monthlyQuota}/mo</span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    className="text-brand-600 hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      setViewing(c);
                    }}
                  >
                    View
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditing(c);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      className="text-rose-600 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        deleteClient(c);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </div>
            </Link>
          ))}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
        )}

      <Modal open={show} onClose={() => setShow(false)} title="New client" disableBackdropClose>
        <NewClientForm
          onDone={() => {
            setShow(false);
            load();
          }}
        />
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Client · ${viewing.name}` : 'Client'}
      >
        {viewing && <ClientDetailView client={viewing} />}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit · ${editing.name}` : 'Edit client'}
        disableBackdropClose
        wide
      >
        {editing && (
          <EditClientForm
            client={editing}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function serviceLabel(s?: string): string {
  if (s === 'EXPORT') return 'Export';
  if (s === 'IMPORT') return 'Import';
  if (s === 'BOTH') return 'Both';
  return '—';
}

function channelLabel(c: { emailEnabled?: boolean; linkedInEnabled?: boolean }): string {
  const email = c.emailEnabled !== false;
  if (c.linkedInEnabled && email) return '📧 Email + 🔗 LinkedIn';
  if (c.linkedInEnabled) return '🔗 LinkedIn only';
  return '📧 Email only';
}

function ClientDetailView({ client }: { client: Client }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Company name', value: client.name },
    { label: 'Invoice no.', value: client.invoiceNo || '—' },
    { label: 'Contact person', value: client.contactPerson || '—' },
    { label: 'Contact email', value: client.email || '—' },
    { label: 'Mobile no.', value: client.mobile || '—' },
    { label: 'Product / Category', value: client.productCategory || '—' },
    { label: 'Service type', value: serviceLabel(client.serviceType) },
    { label: 'Outreach channels', value: channelLabel(client) },
    ...(client.linkedInEnabled ? [{ label: 'LinkedIn sourcing credits', value: client.linkedInCreditMetering ? 'Metered — 1 credit per run' : 'Not metered (free)' }] : []),
    { label: 'Plan', value: client.plan },
    { label: 'Plan validity', value: client.validityDays ? `${client.validityDays} days` : '—' },
    { label: 'Status', value: client.status },
    { label: 'Contacts / month', value: String(client.monthlyQuota) },
    { label: 'Sends / day', value: String(client.dailyBatchSize) },
    { label: 'Batch window (days)', value: String(client.batchWindowDays) },
    { label: 'Gap between stages (days)', value: String(client.stageIntervalDays) },
    { label: 'Follow-ups (after initial)', value: String(client.followUpCount) },
    { label: 'Send window', value: `${hourLabel(client.sendWindowStart)} – ${hourLabel(client.sendWindowEnd)}` },
    { label: 'Interval jitter (± days)', value: String(client.stageIntervalJitterDays) },
    { label: 'Weekdays only', value: client.weekdaysOnly ? 'Yes' : 'No' },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-100 last:border-0">
              <td className="bg-slate-50 px-4 py-2.5 font-medium text-slate-500">{r.label}</td>
              <td className="px-4 py-2.5 text-slate-800">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-lg font-semibold text-brand-700">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

/** LiPlanForm (+ shared plan / WhatsApp from the common form) → subscription PATCH payload. */
function liPlanPayload(p: LiPlanForm, planName: string, whatsappEnabled: boolean, whatsappNumber: string) {
  return {
    planName: planName || undefined,
    seats: p.seats,
    whatsappEnabled,
    whatsappNumber: whatsappNumber || undefined,
    campaignDefaults: p.defaults,
  };
}

function NewClientForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  // Self-registered clients get their company/contact details prefilled.
  const isClient = user?.role === 'CLIENT';
  const { planNames } = usePlans();
  const [form, setForm] = useState({
    name: isClient ? user?.companyName ?? '' : '',
    invoiceNo: '',
    contactPerson: isClient ? user?.name ?? '' : '',
    email: isClient ? user?.email ?? '' : '',
    mobile: isClient ? user?.contactMobile ?? '' : '',
    productCategory: '',
    serviceType: 'EXPORT',
    whatsappEnabled: false,
    whatsappNumber: '',
    plan: 'Growth',
    monthlyQuota: 100,
    dailyBatchSize: 10,
    batchWindowDays: 10,
    stageIntervalDays: 10,
    followUpCount: 4,
    weekdaysOnly: true,
    sendWindowStart: 9,
    sendWindowEnd: 17,
    stageIntervalJitterDays: 2,
  });
  // Which outreach channels this client is subscribed to (admin decides at creation).
  const [channels, setChannels] = useState<'EMAIL' | 'LINKEDIN' | 'BOTH'>('EMAIL');
  const [creditMetering, setCreditMetering] = useState(false);
  const [liPlan, setLiPlan] = useState<LiPlanForm>(emptyLiPlan());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Default to the first available plan if the seeded default isn't present.
  useEffect(() => {
    if (planNames.length && !planNames.includes(form.plan)) {
      setForm((f) => ({ ...f, plan: planNames[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planNames]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // WhatsApp fields belong to the LinkedIn subscription, not the client record.
      const { whatsappEnabled, whatsappNumber, ...clientForm } = form;
      const created = await api.post<{ id: string }>('/clients', {
        ...clientForm,
        invoiceNo: form.invoiceNo || undefined,
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        productCategory: form.productCategory || undefined,
        serviceType: form.serviceType || undefined,
        emailEnabled: channels === 'EMAIL' || channels === 'BOTH',
        linkedInEnabled: channels === 'LINKEDIN' || channels === 'BOTH',
        linkedInCreditMetering: channels !== 'EMAIL' ? creditMetering : false,
        monthlyQuota: Number(form.monthlyQuota),
        dailyBatchSize: Number(form.dailyBatchSize),
        batchWindowDays: Number(form.batchWindowDays),
        stageIntervalDays: Number(form.stageIntervalDays),
        followUpCount: Number(form.followUpCount),
        sendWindowStart: Number(form.sendWindowStart),
        sendWindowEnd: Number(form.sendWindowEnd),
        stageIntervalJitterDays: Number(form.stageIntervalJitterDays),
      });
      // Admin set LinkedIn defaults → persist them onto the client's LinkedIn plan.
      if (!isClient && created?.id && channels !== 'EMAIL') {
        await api.patch(`/linkedin/clients/${created.id}/subscription`, liPlanPayload(liPlan, form.plan, whatsappEnabled, whatsappNumber)).catch(() => {});
      }
      // A client just set up their workspace: full-navigate so the portal
      // sidebar re-fetches and drops them into the new cockpit.
      if (isClient && created?.id) {
        window.location.href = `/clients/${created.id}`;
        return;
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
      {!isClient && (
        <div>
          <label className="label">Outreach channels *</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['EMAIL', '📧 Email', 'Email outreach only'],
              ['LINKEDIN', '🔗 LinkedIn', 'LinkedIn outreach only'],
              ['BOTH', '📧 + 🔗 Both', 'Email and LinkedIn'],
            ] as ['EMAIL' | 'LINKEDIN' | 'BOTH', string, string][]).map(([key, label, desc]) => (
              <button
                type="button"
                key={key}
                onClick={() => setChannels(key)}
                className={`rounded-xl border p-3 text-left transition ${
                  channels === key
                    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                    : 'border-slate-200 hover:border-brand-300'
                }`}
              >
                <div className="text-sm font-semibold text-slate-800">{label}</div>
                <div className="text-xs text-slate-500">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Common client details (shared across channels) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Company name *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Invoice no.</label>
          <input
            className="input"
            value={form.invoiceNo}
            onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
            placeholder="e.g. INV-2026-014"
          />
        </div>
        <div>
          <label className="label">Contact person</label>
          <input
            className="input"
            value={form.contactPerson}
            onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
            placeholder="e.g. Himanshu Sharma"
          />
        </div>
        <div>
          <label className="label">Contact email (report recipient)</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="client@company.com"
          />
        </div>
        <div>
          <label className="label">Client mobile no. (with country code)</label>
          <input
            className="input"
            value={form.mobile}
            onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            placeholder="+91 98765 43210"
          />
        </div>
        <div>
          <label className="label">WhatsApp notifications</label>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })} /> Enabled
          </label>
        </div>
        <div>
          <label className="label">WhatsApp number</label>
          <input
            className="input"
            value={form.whatsappNumber}
            onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
            placeholder="Same as mobile, or a different WhatsApp number"
          />
        </div>
        <div>
          <label className="label">Product / Category</label>
          <input
            className="input"
            value={form.productCategory}
            onChange={(e) => setForm({ ...form, productCategory: e.target.value })}
            placeholder="e.g. Handicrafts, Spices"
          />
        </div>
        <div>
          <label className="label">Service type</label>
          <select
            className="input"
            value={form.serviceType}
            onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
          >
            <option value="EXPORT">Export</option>
            <option value="IMPORT">Import</option>
            <option value="BOTH">Both</option>
          </select>
        </div>
        <div>
          <label className="label">Plan</label>
          <select
            className="input"
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
          >
            {planNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Email business requirements — only when the client uses Email. */}
      {channels !== 'LINKEDIN' && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">📧 Email business requirements</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField label="Contacts / month" value={form.monthlyQuota} onChange={(v) => setForm({ ...form, monthlyQuota: v })} />
            <NumberField label="Sends / day" value={form.dailyBatchSize} onChange={(v) => setForm({ ...form, dailyBatchSize: v })} />
            <NumberField label="Batch window (days)" value={form.batchWindowDays} onChange={(v) => setForm({ ...form, batchWindowDays: v })} />
            <NumberField label="Gap between stages (days)" value={form.stageIntervalDays} onChange={(v) => setForm({ ...form, stageIntervalDays: v })} />
            <NumberField label="Follow-ups (after initial)" value={form.followUpCount} onChange={(v) => setForm({ ...form, followUpCount: v })} />
            <HourField label="Send window start" value={form.sendWindowStart} onChange={(v) => setForm({ ...form, sendWindowStart: v })} />
            <HourField label="Send window end" value={form.sendWindowEnd} onChange={(v) => setForm({ ...form, sendWindowEnd: v })} />
            <NumberField label="Interval jitter (± days)" value={form.stageIntervalJitterDays} onChange={(v) => setForm({ ...form, stageIntervalJitterDays: v })} />
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.weekdaysOnly}
                  onChange={(e) => setForm({ ...form, weekdaysOnly: e.target.checked })}
                />
                Weekdays only
              </label>
            </div>
          </div>
        </div>
      )}

      {/* LinkedIn business requirements — admin-only, when the client uses LinkedIn. */}
      {!isClient && channels !== 'EMAIL' && (
        <LiClientPlanFields value={liPlan} onChange={setLiPlan} creditMetering={creditMetering} onCreditMetering={setCreditMetering} />
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Creating…' : 'Create client'}
      </button>
    </form>
  );
}

function EditClientForm({ client, onDone }: { client: Client; onDone: () => void }) {
  const [form, setForm] = useState({
    name: client.name,
    invoiceNo: client.invoiceNo ?? '',
    contactPerson: client.contactPerson ?? '',
    email: client.email ?? '',
    mobile: client.mobile ?? '',
    productCategory: client.productCategory ?? '',
    serviceType: client.serviceType ?? 'EXPORT',
    whatsappEnabled: false,
    whatsappNumber: '',
    plan: client.plan,
    monthlyQuota: client.monthlyQuota,
    dailyBatchSize: client.dailyBatchSize,
    batchWindowDays: client.batchWindowDays,
    stageIntervalDays: client.stageIntervalDays,
    followUpCount: client.followUpCount,
    weekdaysOnly: client.weekdaysOnly,
    sendWindowStart: client.sendWindowStart,
    sendWindowEnd: client.sendWindowEnd,
    stageIntervalJitterDays: client.stageIntervalJitterDays,
  });
  const [channels, setChannels] = useState<'EMAIL' | 'LINKEDIN' | 'BOTH'>(
    client.linkedInEnabled
      ? (client.emailEnabled !== false ? 'BOTH' : 'LINKEDIN')
      : 'EMAIL',
  );
  const [creditMetering, setCreditMetering] = useState(!!client.linkedInCreditMetering);
  const [liPlan, setLiPlan] = useState<LiPlanForm>(emptyLiPlan());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState(client.owner?.email ?? client.email ?? '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginNote, setLoginNote] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const hasOwner = !!client.owner;
  const [ownerName, setOwnerName] = useState(client.owner?.name ?? '');
  const [ownerEmail, setOwnerEmail] = useState(client.owner?.email ?? '');
  const [ownerMobile, setOwnerMobile] = useState(client.owner?.contactMobile ?? '');
  const [ownerNote, setOwnerNote] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [status, setStatus] = useState((client.status ?? 'active').toLowerCase());
  const [statusBusy, setStatusBusy] = useState(false);
  const { planNames } = usePlans();
  // Always include the client's current plan even if it was later removed.
  const planOptions = [...new Set([client.plan, ...planNames].filter(Boolean))];

  // Prefill the LinkedIn plan/defaults + shared WhatsApp from the client's subscription.
  useEffect(() => {
    if (!client.linkedInEnabled) return;
    api.get<LiSubscription>(`/linkedin/clients/${client.id}/subscription`).then((s) => {
      setLiPlan({ seats: s.seats ?? 1, defaults: { ...LI_DEFAULTS, ...(s.campaignDefaults ?? {}) } });
      setForm((f) => ({ ...f, whatsappEnabled: !!s.whatsappEnabled, whatsappNumber: s.whatsappNumber ?? '' }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  async function toggleStatus(active: boolean) {
    if (
      !active &&
      !confirm(
        'Deactivate this client?\n\nAll its running cohorts will be paused and will not send until you reactivate.',
      )
    )
      return;
    setStatusBusy(true);
    try {
      const r = await api.patch<{ status: string }>(`/clients/${client.id}/status`, {
        active,
      });
      setStatus(r.status);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveOwner() {
    setOwnerBusy(true);
    setOwnerNote('');
    try {
      await api.patch(`/clients/${client.id}/owner`, {
        name: ownerName,
        email: ownerEmail,
        mobile: ownerMobile,
      });
      setOwnerNote('Client identity updated.');
    } catch (e) {
      setOwnerNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setOwnerBusy(false);
    }
  }

  async function resetDefault() {
    if (!confirm('Reset this client to the default password "grapout@123"?')) return;
    setOwnerBusy(true);
    setOwnerNote('');
    try {
      const r = await api.post<{ password: string }>(`/clients/${client.id}/reset-password`);
      setOwnerNote(`Password reset to: ${r.password} — ask the client to change it after signing in.`);
    } catch (e) {
      setOwnerNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setOwnerBusy(false);
    }
  }

  async function saveLogin() {
    if (!loginEmail || !loginPassword) {
      setLoginNote('Enter an email and password.');
      return;
    }
    setLoginBusy(true);
    setLoginNote('');
    try {
      await api.post(`/clients/${client.id}/login`, {
        email: loginEmail,
        password: loginPassword,
      });
      setLoginNote(`Client login set: ${loginEmail}`);
      setLoginPassword('');
    } catch (e) {
      setLoginNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.patch(`/clients/${client.id}`, {
        name: form.name,
        invoiceNo: form.invoiceNo || undefined,
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        productCategory: form.productCategory || undefined,
        serviceType: form.serviceType || undefined,
        emailEnabled: channels === 'EMAIL' || channels === 'BOTH',
        linkedInEnabled: channels === 'LINKEDIN' || channels === 'BOTH',
        linkedInCreditMetering: channels !== 'EMAIL' ? creditMetering : false,
        plan: form.plan,
        monthlyQuota: Number(form.monthlyQuota),
        dailyBatchSize: Number(form.dailyBatchSize),
        batchWindowDays: Number(form.batchWindowDays),
        stageIntervalDays: Number(form.stageIntervalDays),
        followUpCount: Number(form.followUpCount),
        weekdaysOnly: form.weekdaysOnly,
        sendWindowStart: Number(form.sendWindowStart),
        sendWindowEnd: Number(form.sendWindowEnd),
        stageIntervalJitterDays: Number(form.stageIntervalJitterDays),
      });
      // Persist LinkedIn plan/defaults + shared WhatsApp when the client uses LinkedIn.
      if (channels !== 'EMAIL') {
        await api.patch(`/linkedin/clients/${client.id}/subscription`, liPlanPayload(liPlan, form.plan, form.whatsappEnabled, form.whatsappNumber)).catch(() => {});
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const active = status === 'active';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
              active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-xs text-slate-500">
            {active
              ? 'Client is running. Deactivate to pause all its cohorts.'
              : 'Client is paused. Activate to resume its cohorts.'}
          </span>
        </div>
        <button
          type="button"
          className={active ? 'btn-ghost text-rose-600' : 'btn-primary'}
          onClick={() => toggleStatus(!active)}
          disabled={statusBusy}
        >
          {statusBusy ? '…' : active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Client details
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Company name *</label>
            <input className="input" value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Invoice no.</label>
            <input className="input" value={form.invoiceNo}
              onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} />
          </div>
          <div>
            <label className="label">Contact person</label>
            <input className="input" value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          </div>
          <div>
            <label className="label">Contact email (report recipient)</label>
            <input type="email" className="input" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Client mobile no. (with country code)</label>
            <input className="input" value={form.mobile} placeholder="+91 98765 43210"
              onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </div>
          <div>
            <label className="label">WhatsApp notifications</label>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div>
            <label className="label">WhatsApp number</label>
            <input className="input" value={form.whatsappNumber} placeholder="Same as mobile, or a different WhatsApp number"
              onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} />
          </div>
          <div>
            <label className="label">Product / Category</label>
            <input className="input" value={form.productCategory}
              onChange={(e) => setForm({ ...form, productCategory: e.target.value })} />
          </div>
          <div>
            <label className="label">Service type</label>
            <select className="input" value={form.serviceType}
              onChange={(e) => setForm({ ...form, serviceType: e.target.value })}>
              <option value="EXPORT">Export</option>
              <option value="IMPORT">Import</option>
              <option value="BOTH">Both</option>
            </select>
          </div>
          <div>
            <label className="label">Plan</label>
            <select className="input" value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {planOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Outreach channels</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['EMAIL', '📧 Email', 'Email only'],
                ['LINKEDIN', '🔗 LinkedIn', 'LinkedIn only'],
                ['BOTH', '📧 + 🔗 Both', 'Email and LinkedIn'],
              ] as ['EMAIL' | 'LINKEDIN' | 'BOTH', string, string][]).map(([key, label, desc]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setChannels(key)}
                  className={`rounded-xl border p-3 text-left transition ${
                    channels === key
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                      : 'border-slate-200 hover:border-brand-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-800">{label}</div>
                  <div className="text-xs text-slate-500">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Email business requirements — only when the client uses Email. */}
      {channels !== 'LINKEDIN' && (
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          📧 Email business requirements
        </div>
        <p className="mb-2 text-xs text-amber-600">
          ⚠ Changes apply to future scheduling only — running cohorts keep their
          already-scheduled sends.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField label="Contacts / month" value={form.monthlyQuota} onChange={(v) => setForm({ ...form, monthlyQuota: v })} />
          <NumberField label="Sends / day" value={form.dailyBatchSize} onChange={(v) => setForm({ ...form, dailyBatchSize: v })} />
          <NumberField label="Batch window (days)" value={form.batchWindowDays} onChange={(v) => setForm({ ...form, batchWindowDays: v })} />
          <NumberField label="Gap between stages (days)" value={form.stageIntervalDays} onChange={(v) => setForm({ ...form, stageIntervalDays: v })} />
          <NumberField label="Follow-ups (after initial)" value={form.followUpCount} onChange={(v) => setForm({ ...form, followUpCount: v })} />
          <HourField label="Send window start" value={form.sendWindowStart} onChange={(v) => setForm({ ...form, sendWindowStart: v })} />
          <HourField label="Send window end" value={form.sendWindowEnd} onChange={(v) => setForm({ ...form, sendWindowEnd: v })} />
          <NumberField label="Interval jitter (± days)" value={form.stageIntervalJitterDays} onChange={(v) => setForm({ ...form, stageIntervalJitterDays: v })} />
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.weekdaysOnly}
                onChange={(e) => setForm({ ...form, weekdaysOnly: e.target.checked })} />
              Weekdays only
            </label>
          </div>
        </div>
      </div>
      )}

      {/* LinkedIn business requirements — when the client uses LinkedIn. */}
      {channels !== 'EMAIL' && (
        <LiClientPlanFields value={liPlan} onChange={setLiPlan} creditMetering={creditMetering} onCreditMetering={setCreditMetering} />
      )}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Client portal login
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Give this client a login to their own scoped panel (this profile only, no delete).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Login email</label>
            <input type="email" className="input" value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)} placeholder="client@company.com" />
          </div>
          <div>
            <label className="label">Set / reset password</label>
            <input type="password" className="input" value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn-ghost text-xs" onClick={saveLogin} disabled={loginBusy}>
            {loginBusy ? 'Saving…' : hasOwner ? 'Update login email / password' : 'Create client login'}
          </button>
          {loginNote && <span className="text-xs text-slate-500">{loginNote}</span>}
        </div>

        {hasOwner && (
          <div className="mt-4 border-t border-emerald-200 pt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Client identity (registration details)
            </div>
            <p className="mb-3 text-xs text-slate-500">
              The client sees these read-only in their portal — only you can change them.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Contact name</label>
                <input className="input" value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={ownerMobile}
                  onChange={(e) => setOwnerMobile(e.target.value)} placeholder="+91 98765 43210" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost text-xs" onClick={saveOwner} disabled={ownerBusy}>
                {ownerBusy ? 'Saving…' : 'Save identity'}
              </button>
              <button type="button" className="text-xs font-medium text-amber-700 hover:underline"
                onClick={resetDefault} disabled={ownerBusy}>
                Reset to default password (grapout@123)
              </button>
              {ownerNote && <span className="text-xs text-slate-500">{ownerNote}</span>}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

function HourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
