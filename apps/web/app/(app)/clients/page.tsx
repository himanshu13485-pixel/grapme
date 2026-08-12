'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCanDelete, useCanEdit, useAuth } from '@/lib/auth';
import { usePlans, Plan } from '@/lib/plans';
import { PageHeader, EmptyState, Modal, StatusBadge, Pagination } from '@/components/ui';
import { LiClientPlanFields, LiClientSendWindowFields, LiPlanForm, emptyLiPlan } from '@/components/LiClientPlanFields';
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
  emailCredits?: number;
  emailCreditMetering?: boolean;
  mailboxLimit?: number;
  emailCampaignLimit?: number;
  plan: string;
  status: string;
  monthlyQuota: number;
  dailyBatchSize: number;
  batchWindowDays: number;
  stageIntervalDays: number;
  followUpCount: number;
  weekdaysOnly: boolean;
  workDays: number[];
  emailJitterSeconds: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  stageIntervalJitterDays: number;
  validityDays?: number | null;
  validityStartAt?: string | null;
  validityEndAt?: string | null;
  _count?: { mailboxes: number; cohorts: number; enrollments: number; contacts: number };
  stats?: { emailSent: number; emailOpens: number; contacts: number; liInvites: number; liConnected: number; liLeads: number };
  owner?: { id: string; name: string; email: string; contactMobile?: string | null; emailVerified?: boolean | null; pendingEmail?: string | null } | null;
  salesPerson?: { id: string; name: string; email: string } | null;
  operationContacts?: { name: string; email: string }[];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // Onboarding/setup progress per client (Reporting) → the "Account Setup" bar.
  const [setupProgress, setSetupProgress] = useState<Record<string, { percent: number; finished: number; total: number }>>({});
  const [show, setShow] = useState(false);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [bulkAssign, setBulkAssign] = useState(false);
  const [q, setQ] = useState('');
  const [invoiceQ, setInvoiceQ] = useState('');
  const [emailQ, setEmailQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [salesFilter, setSalesFilter] = useState('ALL'); // ALL | none | <salespersonId>
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string }[]>([]);
  const [dateField, setDateField] = useState<'expiry' | 'created'>('expiry');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;
  const canDelete = useCanDelete();
  const canEdit = useCanEdit();
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
    !!dq || !!dEmail || !!dInvoice || statusFilter !== 'ALL' || planFilter !== 'ALL' ||
    channelFilter !== 'ALL' || salesFilter !== 'ALL' || !!dateFrom || !!dateTo;

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (dq) params.set('q', dq);
    if (dEmail) params.set('email', dEmail);
    if (dInvoice && !isClient) params.set('invoice', dInvoice);
    if (statusFilter !== 'ALL') params.set('status', statusFilter.toLowerCase());
    if (planFilter !== 'ALL') params.set('plan', planFilter);
    if (channelFilter !== 'ALL') params.set('channel', channelFilter);
    if (salesFilter !== 'ALL') params.set('salesPersonId', salesFilter);
    // Date range applies to either the subscription expiry or the created date.
    if (!isClient && (dateFrom || dateTo)) {
      const fromKey = dateField === 'created' ? 'createdFrom' : 'expiryFrom';
      const toKey = dateField === 'created' ? 'createdTo' : 'expiryTo';
      if (dateFrom) params.set(fromKey, dateFrom);
      if (dateTo) params.set(toKey, dateTo);
    }
    api
      .get<{ items: Client[]; total: number }>(`/clients/paged?${params.toString()}`)
      .then((r) => {
        setClients(r.items);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [page, dq, dEmail, dInvoice, statusFilter, planFilter, channelFilter, salesFilter, dateField, dateFrom, dateTo, isClient]);

  // Reset to page 1 whenever the filters change, then (re)fetch.
  useEffect(() => setPage(1), [dq, dEmail, dInvoice, statusFilter, planFilter, channelFilter, salesFilter, dateField, dateFrom, dateTo]);

  // Setup/onboarding progress for the "Account Setup" bar on each workspace box.
  useEffect(() => {
    if (!isAdmin) return;
    api.get<Record<string, { percent: number; finished: number; total: number }>>('/reporting/progress')
      .then(setSetupProgress).catch(() => {});
  }, [isAdmin, loaded]);

  // Salesperson filter options (admins only).
  useEffect(() => {
    if (!isAdmin) return;
    api.get<{ id: string; name: string }[]>('/sales/persons').then(setSalesPersons).catch(() => {});
  }, [isAdmin]);
  useEffect(() => {
    load();
  }, [load]);

  // The sidebar "Set up my workspace" links here with ?new=1 to open the form.
  // Subscription Management links here with ?edit=<id> to open that client's edit form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      setShow(true);
      window.history.replaceState(null, '', '/clients');
    }
    const editId = params.get('edit');
    if (editId) {
      window.history.replaceState(null, '', '/clients');
      api.get<Client>(`/clients/${editId}`).then((c) => setEditing(c)).catch(() => {});
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

  async function logoutClient(c: Client) {
    if (
      !confirm(
        `Sign "${c.name}" out of every device / session?\n\nThey stay signed in for up to 15 minutes (until their current access token expires), then must log in again.`,
      )
    )
      return;
    try {
      const r = await api.post<{ revoked: number }>(`/admin/clients/${c.id}/logout`, {});
      alert(
        r.revoked > 0
          ? `Signed out — ${r.revoked} active session${r.revoked === 1 ? '' : 's'} revoked.`
          : 'This client had no active sessions.',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to sign out');
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
          isAdmin ? (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setBulkAssign(true)}>Assign salesperson</button>
              <button className="btn-primary" onClick={() => setShow(true)}>+ New client</button>
            </div>
          ) : clientCanAdd ? (
            <button className="btn-primary" onClick={() => setShow(true)}>
              {isClient
                ? total === 0
                  ? '+ Set up my workspace'
                  : '+ Add profile'
                : '+ Add profile'}
            </button>
          ) : null
        }
      />
      {bulkAssign && (
        <BulkAssignSalesperson
          clients={clients}
          onClose={() => setBulkAssign(false)}
          onDone={() => { setBulkAssign(false); load(); }}
        />
      )}

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
              <option value="ALL">All subscriptions</option>
              <option value="CURRENT">Current subscription</option>
              <option value="EXPIRED">Subscription expired</option>
              <option value="DEACTIVATED">Deactivated</option>
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
          {!isClient && (
            <select
              className="input w-44"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            >
              <option value="ALL">All channels</option>
              <option value="EMAIL">📧 Email only</option>
              <option value="LINKEDIN">🔗 LinkedIn only</option>
              <option value="BOTH">📧 + 🔗 Both</option>
            </select>
          )}
          {isAdmin && (
            <select
              className="input w-48"
              value={salesFilter}
              onChange={(e) => setSalesFilter(e.target.value)}
              title="Filter by assigned salesperson"
            >
              <option value="ALL">All salespersons</option>
              <option value="none">— Unassigned —</option>
              {salesPersons.map((p) => <option key={p.id} value={p.id}>🧑‍💼 {p.name}</option>)}
            </select>
          )}
          {!isClient && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <select
                className="input w-[7.5rem]"
                value={dateField}
                onChange={(e) => setDateField(e.target.value as 'expiry' | 'created')}
                title="Which date to search by"
              >
                <option value="expiry">Expiry date</option>
                <option value="created">Created date</option>
              </select>
              <input
                type="date"
                className="input w-[9.5rem]"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                title={dateField === 'created' ? 'Created on / after' : 'Subscription expires on / after'}
              />
              <span>–</span>
              <input
                type="date"
                className="input w-[9.5rem]"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                title={dateField === 'created' ? 'Created on / before' : 'Subscription expires on / before'}
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-600"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  title="Clear date filter"
                >
                  ✕
                </button>
              )}
            </div>
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
                <div className="flex items-center gap-1.5">
                  {c.validityEndAt && new Date(c.validityEndAt) < new Date() && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Expired</span>
                  )}
                  <StatusBadge status={(c.status ?? 'active').toLowerCase() === 'active' ? 'ACTIVE' : 'INACTIVE'} />
                </div>
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
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  {channelLabel(c)}
                </span>
                {isAdmin && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c.salesPerson ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.salesPerson ? `🧑‍💼 ${c.salesPerson.name}` : 'No salesperson'}
                  </span>
                )}
              </div>
              {c.emailEnabled !== false && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Sent" value={c.stats?.emailSent ?? 0} />
                  <Stat label="Opens" value={c.stats?.emailOpens ?? 0} />
                  <Stat label="Contacts" value={c.stats?.contacts ?? c._count?.contacts ?? 0} />
                </div>
              )}
              {c.linkedInEnabled && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Invites" value={c.stats?.liInvites ?? 0} />
                  <Stat label="Connected" value={c.stats?.liConnected ?? 0} />
                  <Stat label="Leads" value={c.stats?.liLeads ?? 0} />
                </div>
              )}
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
                  {isAdmin && canEdit && (
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
                  {isAdmin && c.owner && (
                    <button
                      type="button"
                      className="text-amber-600 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        logoutClient(c);
                      }}
                    >
                      Log out
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
              {isAdmin && setupProgress[c.id] && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Account Setup</span>
                    <span className="text-slate-700">{setupProgress[c.id].percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${setupProgress[c.id].percent >= 100 ? 'bg-emerald-500' : setupProgress[c.id].percent > 0 ? 'bg-brand-500' : 'bg-slate-300'}`}
                      style={{ width: `${Math.min(100, Math.max(0, setupProgress[c.id].percent))}%` }}
                    />
                  </div>
                </div>
              )}
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
function formatDays(days?: number[] | null): string {
  if (!days || days.length === 0) return '—';
  return [...days].sort().map((x) => DAY_LABELS[x] ?? x).join(', ');
}
/** Mon–Sun multi-select for send days (0=Sun … 6=Sat). */
function DaysField({ label, value, onChange }: { label: string; value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="sm:col-span-2">
      <label className="label">{label}</label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {DAY_ORDER.map((d) => (
          <button key={d} type="button" onClick={() => toggle(d)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${value.includes(d) ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>
    </div>
  );
}
/** A limit where 0 means unlimited. */
const limitLabel = (n?: number | null) => (n && n > 0 ? String(n) : 'Unlimited');

function ClientDetailView({ client }: { client: Client }) {
  const { user } = useAuth();
  const { plans } = usePlans();
  const isClient = user?.role === 'CLIENT';
  const base = isClient ? '/linkedin/portal' : '/linkedin';
  const emailOn = client.emailEnabled !== false;
  const linkedInOn = !!client.linkedInEnabled;
  const [sub, setSub] = useState<LiSubscription | null>(null);
  const plan = plans.find((p) => p.name === client.plan);

  useEffect(() => {
    if (!linkedInOn) return;
    api.get<LiSubscription>(`${base}/clients/${client.id}/subscription`).then(setSub).catch(() => {});
  }, [client.id, linkedInOn, base]);

  const d = { ...LI_DEFAULTS, ...(sub?.campaignDefaults ?? {}) };
  const validity = client.validityDays ?? plan?.validityDays ?? null;

  const clientRows: DetailRow[] = [
    { label: 'Company name', value: client.name },
    { label: 'Invoice no.', value: client.invoiceNo || '—' },
    { label: 'Contact person', value: client.contactPerson || '—' },
    { label: 'Contact email', value: client.email || '—' },
    { label: 'Login email', value: client.owner?.email ? `${client.owner.email}${client.owner.emailVerified === false ? ' · unverified' : ''}${client.owner.pendingEmail ? ` · change to ${client.owner.pendingEmail} pending confirmation` : ''}` : '— (no portal login)' },
    { label: 'Mobile no.', value: client.mobile || '—' },
    ...(linkedInOn ? [{ label: 'WhatsApp notifications', value: sub?.whatsappEnabled ? (sub?.whatsappNumber || 'Enabled') : 'Off' }] : []),
    { label: 'Product / Category', value: client.productCategory || '—' },
    { label: 'Service type', value: serviceLabel(client.serviceType) },
    { label: 'Outreach channels', value: channelLabel(client) },
    { label: 'Plan', value: client.plan },
    { label: 'Plan validity', value: validity ? `${validity} days` : '—' },
    { label: 'Status', value: client.status },
  ];
  const emailRows: DetailRow[] = emailOn ? [
    { label: 'Credits', value: `${client.emailCredits ?? 0}${client.emailCreditMetering ? ' · metered (1/email)' : ' · unmetered'}` },
    { label: 'Mailboxes (allowed)', value: limitLabel(client.mailboxLimit) },
    { label: 'Campaigns (allowed)', value: limitLabel(client.emailCampaignLimit) },
    { label: 'Contacts / month', value: String(client.monthlyQuota) },
    { label: 'Sends / day', value: String(client.dailyBatchSize) },
    { label: 'Batch window (days)', value: String(client.batchWindowDays) },
    { label: 'Gap between stages (days)', value: String(client.stageIntervalDays) },
    { label: 'Follow-ups (after initial)', value: String(client.followUpCount) },
    { label: 'Send window', value: `${hourLabel(client.sendWindowStart)} – ${hourLabel(client.sendWindowEnd)}` },
    { label: 'Interval jitter (± days)', value: String(client.stageIntervalJitterDays) },
    { label: 'Send days', value: formatDays(client.workDays) },
    { label: 'Send stagger (± sec)', value: String(client.emailJitterSeconds ?? 20) },
  ] : [];
  const linkedinRows: DetailRow[] = linkedInOn ? [
    { label: 'Credits', value: String(sub?.creditsBalance ?? 0) },
    { label: 'Seats', value: String(sub?.seats ?? 0) },
    { label: 'Campaigns (allowed)', value: limitLabel(sub?.campaignLimit) },
    { label: 'Send window', value: `${hourLabel(d.workStartHour)} – ${hourLabel(d.workEndHour)}` },
    { label: 'Send days', value: formatDays(d.workDays) },
    { label: 'Send wobble (± sec)', value: `${d.jitterMinSeconds ?? 20}–${d.jitterMaxSeconds ?? 90}` },
    { label: 'Max connection invites / day', value: String(d.dailyConnectionLimit) },
    { label: 'Max messages / day', value: String(d.dailyMessageLimit) },
    // Admin-only tuning (kept secret from the client panel).
    ...(!isClient ? [
      { label: 'Warm-up ramp', value: d.warmupEnabled ? `${d.warmupStartLimit}/day → full over ${d.warmupDays} days` : 'Off' },
      { label: 'Auto lead sourcing (drip)', value: d.dripEnabled ? `${d.dripDailyTarget}/day · refill below ${d.dripBuffer}` : 'Off' },
      { label: 'LinkedIn sourcing credits', value: client.linkedInCreditMetering ? 'Metered — 1 credit per run' : 'Not metered (free)' },
    ] : []),
  ] : [];

  return (
    <div className="space-y-5">
      <DetailSection title="Client details" rows={clientRows} />
      {emailRows.length > 0 && <DetailSection title="📧 Email business requirements" rows={emailRows} />}
      {linkedinRows.length > 0 && <DetailSection title="🔗 LinkedIn business requirements" rows={linkedinRows} />}
    </div>
  );
}

type DetailRow = { label: string; value: string };
function DetailSection({ title, rows }: { title: string; rows: DetailRow[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0">
                <td className="w-1/2 bg-slate-50 px-4 py-2.5 font-medium text-slate-500">{r.label}</td>
                <td className="px-4 py-2.5 text-slate-800">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

/** Compact "what this plan grants" hint shown under the Plan picker. */
function PlanAllowance({ plan }: { plan?: Plan }) {
  if (!plan) return null;
  const ch = plan.emailEnabled !== false && plan.linkedInEnabled !== false ? '📧+🔗'
    : plan.linkedInEnabled !== false ? '🔗' : '📧';
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
      {ch} · validity {plan.validityDays ?? 0}d
      {plan.emailEnabled !== false && <> · 📧 {plan.emailCredits ?? 0} cr / {plan.mailboxLimit ?? 0} mbx / {plan.emailCampaignLimit ?? 0} camp</>}
      {plan.linkedInEnabled !== false && <> · 🔗 {plan.linkedInCredits ?? 0} cr / {plan.seatLimit ?? 0} seats / {plan.linkedInCampaignLimit ?? 0} camp</>}
    </p>
  );
}

/** LiPlanForm (+ shared plan / WhatsApp from the common form) → subscription PATCH payload. */
function liPlanPayload(p: LiPlanForm, planName: string, whatsappEnabled: boolean, whatsappNumber: string) {
  return {
    planName: planName || undefined,
    seats: p.seats,
    campaignLimit: p.campaignLimit,
    creditsBalance: p.credits,
    whatsappEnabled,
    whatsappNumber: whatsappNumber || undefined,
    campaignDefaults: p.defaults,
  };
}

function NewClientForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  // Self-registered clients get their company/contact details prefilled.
  const isClient = user?.role === 'CLIENT';
  const { planNames, plans } = usePlans();
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
    validityDays: 0,
    // Prefilled business-requirement defaults for a new client (admin can still edit).
    emailCredits: 1000,
    emailCreditMetering: false,
    mailboxLimit: 3,
    emailCampaignLimit: 0,
    plan: 'Growth',
    monthlyQuota: 100,
    dailyBatchSize: 10,
    batchWindowDays: 10,
    stageIntervalDays: 15,
    followUpCount: 1,
    weekdaysOnly: true,
    workDays: [1, 2, 3, 4, 5] as number[],
    emailJitterSeconds: 600,
    sendWindowStart: 9,
    sendWindowEnd: 18,
    stageIntervalJitterDays: 2,
  });
  // Which outreach channels this client is subscribed to (admin decides at creation).
  const [channels, setChannels] = useState<'EMAIL' | 'LINKEDIN' | 'BOTH'>('EMAIL');
  const [creditMetering, setCreditMetering] = useState(true); // default: charge 1 credit / lead-sourcing run
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
        linkedInCreditMetering: !isClient && channels !== 'EMAIL' ? creditMetering : false,
        // Client self-service LinkedIn request carries only the basic send window;
        // the server routes it through admin approval (see createClient).
        ...(isClient && channels !== 'EMAIL'
          ? {
              linkedin: {
                workStartHour: liPlan.defaults.workStartHour,
                workEndHour: liPlan.defaults.workEndHour,
                workDays: liPlan.defaults.workDays,
                dailyConnectionLimit: liPlan.defaults.dailyConnectionLimit,
                dailyMessageLimit: liPlan.defaults.dailyMessageLimit,
              },
            }
          : {}),
        monthlyQuota: Number(form.monthlyQuota),
        dailyBatchSize: Number(form.dailyBatchSize),
        batchWindowDays: Number(form.batchWindowDays),
        stageIntervalDays: Number(form.stageIntervalDays),
        followUpCount: Number(form.followUpCount),
        sendWindowStart: Number(form.sendWindowStart),
        sendWindowEnd: Number(form.sendWindowEnd),
        stageIntervalJitterDays: Number(form.stageIntervalJitterDays),
        workDays: form.workDays,
        emailJitterSeconds: Number(form.emailJitterSeconds),
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
        {isClient && channels !== 'EMAIL' && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⏳ Your workspace starts on Email right away. LinkedIn activation is reviewed by your account team before it goes live.
          </p>
        )}
      </div>
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
            onChange={(e) => {
              const name = e.target.value;
              const p = plans.find((pl) => pl.name === name);
              setForm((f) => ({ ...f, plan: name, ...(p ? { validityDays: p.validityDays ?? 0, emailCredits: p.emailCredits ?? 0, mailboxLimit: p.mailboxLimit ?? 0, emailCampaignLimit: p.emailCampaignLimit ?? 0 } : {}) }));
              if (p) setLiPlan((lp) => ({ ...lp, seats: p.seatLimit || lp.seats, credits: p.linkedInCredits ?? 0, campaignLimit: p.linkedInCampaignLimit ?? 0 }));
            }}
          >
            {planNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <PlanAllowance plan={plans.find((p) => p.name === form.plan)} />
        </div>
        {!isClient && (
          <div>
            <label className="label">Validity (days)</label>
            <input className="input" type="number" min={0} value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Math.max(0, Number(e.target.value) || 0) })} placeholder="0 = no expiry" />
          </div>
        )}
      </div>

      {/* Email business requirements — only when the client uses Email. */}
      {channels !== 'LINKEDIN' && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">📧 Email business requirements</div>
          {!isClient && (
            <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Credits" value={form.emailCredits} onChange={(v) => setForm({ ...form, emailCredits: v })} />
                <NumberField label="Mailboxes (0=∞)" value={form.mailboxLimit} onChange={(v) => setForm({ ...form, mailboxLimit: v })} />
                <NumberField label="Campaigns (0=∞)" value={form.emailCampaignLimit} onChange={(v) => setForm({ ...form, emailCampaignLimit: v })} />
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.emailCreditMetering} onChange={(e) => setForm({ ...form, emailCreditMetering: e.target.checked })} />
                Meter email sends — <strong>1 credit per email</strong> (off = unlimited)
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField label="Contacts / month" value={form.monthlyQuota} onChange={(v) => setForm({ ...form, monthlyQuota: v })} />
            <NumberField label="Sends / day" value={form.dailyBatchSize} onChange={(v) => setForm({ ...form, dailyBatchSize: v })} />
            <NumberField label="Batch window (days)" value={form.batchWindowDays} onChange={(v) => setForm({ ...form, batchWindowDays: v })} />
            <NumberField label="Gap between stages (days)" value={form.stageIntervalDays} onChange={(v) => setForm({ ...form, stageIntervalDays: v })} />
            <NumberField label="Follow-ups (after initial)" value={form.followUpCount} onChange={(v) => setForm({ ...form, followUpCount: v })} />
            <HourField label="Send window start" value={form.sendWindowStart} onChange={(v) => setForm({ ...form, sendWindowStart: v })} />
            <HourField label="Send window end" value={form.sendWindowEnd} onChange={(v) => setForm({ ...form, sendWindowEnd: v })} />
            <NumberField label="Interval jitter (± days)" value={form.stageIntervalJitterDays} onChange={(v) => setForm({ ...form, stageIntervalJitterDays: v })} />
            <NumberField label="Send stagger (± sec)" value={form.emailJitterSeconds} onChange={(v) => setForm({ ...form, emailJitterSeconds: v })} />
            <DaysField label="Send days" value={form.workDays} onChange={(v) => setForm({ ...form, workDays: v })} />
          </div>
        </div>
      )}

      {/* LinkedIn business requirements — admin-only, when the client uses LinkedIn. */}
      {!isClient && channels !== 'EMAIL' && (
        <LiClientPlanFields value={liPlan} onChange={setLiPlan} creditMetering={creditMetering} onCreditMetering={setCreditMetering} />
      )}

      {/* LinkedIn send window — client self-service (basic only; tuning stays admin-side). */}
      {isClient && channels !== 'EMAIL' && (
        <LiClientSendWindowFields value={liPlan} onChange={setLiPlan} />
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
    validityDays: client.validityDays ?? 0,
    emailCredits: client.emailCredits ?? 0,
    emailCreditMetering: client.emailCreditMetering ?? false,
    mailboxLimit: client.mailboxLimit ?? 0,
    emailCampaignLimit: client.emailCampaignLimit ?? 0,
    plan: client.plan,
    monthlyQuota: client.monthlyQuota,
    dailyBatchSize: client.dailyBatchSize,
    batchWindowDays: client.batchWindowDays,
    stageIntervalDays: client.stageIntervalDays,
    followUpCount: client.followUpCount,
    weekdaysOnly: client.weekdaysOnly,
    workDays: client.workDays ?? [1, 2, 3, 4, 5],
    emailJitterSeconds: client.emailJitterSeconds ?? 20,
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
  const [showLoginPw, setShowLoginPw] = useState(false);
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
  // Assigned salesperson (saved independently via /sales/assign).
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; email: string }[]>([]);
  const [salesPersonId, setSalesPersonId] = useState(client.salesPerson?.id ?? '');
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesMsg, setSalesMsg] = useState('');
  const [opsContacts, setOpsContacts] = useState<{ name: string; email: string }[]>(client.operationContacts ?? []);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState('');
  const { planNames, plans } = usePlans();
  // Always include the client's current plan even if it was later removed.
  const planOptions = [...new Set([client.plan, ...planNames].filter(Boolean))];

  // Prefill the LinkedIn plan/defaults + shared WhatsApp from the client's subscription.
  useEffect(() => {
    if (!client.linkedInEnabled) return;
    api.get<LiSubscription>(`/linkedin/clients/${client.id}/subscription`).then((s) => {
      setLiPlan({ seats: s.seats ?? 1, credits: s.creditsBalance ?? 0, campaignLimit: s.campaignLimit ?? 0, defaults: { ...LI_DEFAULTS, ...(s.campaignDefaults ?? {}) } });
      setForm((f) => ({ ...f, whatsappEnabled: !!s.whatsappEnabled, whatsappNumber: s.whatsappNumber ?? '' }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    api.get<{ id: string; name: string; email: string }[]>('/sales/persons').then(setSalesPersons).catch(() => {});
  }, []);

  async function saveSalesperson() {
    setSalesBusy(true); setSalesMsg('');
    try {
      await api.post('/sales/assign', { salesPersonId: salesPersonId || null, clientIds: [client.id] });
      setSalesMsg('Saved');
    } catch {
      setSalesMsg('Failed');
    } finally { setSalesBusy(false); }
  }

  async function persistOps() {
    const clean = opsContacts.map((o) => ({ name: o.name.trim(), email: o.email.trim() })).filter((o) => o.email);
    await api.patch(`/clients/${client.id}`, { operationContacts: clean });
    setOpsContacts(clean);
    return clean;
  }

  async function saveOps() {
    setOpsBusy(true); setOpsMsg('');
    try {
      await persistOps();
      setOpsMsg('Saved');
    } catch {
      setOpsMsg('Failed');
    } finally { setOpsBusy(false); }
  }

  async function sendOpsTest() {
    setOpsBusy(true); setOpsMsg('');
    try {
      await persistOps(); // test the current (saved) recipients
      const r = await api.post<{ sent: string[] }>(`/clients/${client.id}/campaign-reminder/test`);
      setOpsMsg(`Test sent to: ${r.sent.join(', ')}`);
    } catch (e) {
      setOpsMsg(e instanceof Error ? e.message : 'Test failed');
    } finally { setOpsBusy(false); }
  }

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
      const res = await api.patch<{ email: string; pending?: boolean; pendingEmail?: string }>(
        `/clients/${client.id}/owner`,
        { name: ownerName, email: ownerEmail, mobile: ownerMobile },
      );
      if (res.pending) {
        setOwnerNote(`Name/phone saved. Login-email change to ${res.pendingEmail} is pending — a confirmation link was sent, and it's queued in Approvals. The current login (${res.email}) keeps working until confirmed.`);
        setOwnerEmail(res.email); // the email hasn't changed yet
      } else {
        setOwnerNote('Client identity updated.');
      }
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
    if (!loginEmail) { setLoginNote('Enter a login email.'); return; }
    if (!hasOwner && !loginPassword) { setLoginNote('Set a password to create the login.'); return; }
    setLoginBusy(true);
    setLoginNote('');
    try {
      const res = await api.post<{ ok: boolean; pending?: boolean; pendingEmail?: string; email: string }>(
        `/clients/${client.id}/login`,
        { email: loginEmail, ...(loginPassword ? { password: loginPassword } : {}) },
      );
      if (res.pending) {
        setLoginNote(`Login-email change pending. A confirmation link was sent to ${res.pendingEmail}, and it's queued in Approvals (approve there if the client doesn't get the email). The current login (${res.email}) keeps working until it's confirmed.`);
        setLoginEmail(res.email); // reflect that the change hasn't applied yet
      } else {
        setLoginNote(`Client login saved: ${res.email}`);
      }
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
        validityDays: Number(form.validityDays),
        emailCredits: Number(form.emailCredits),
        emailCreditMetering: form.emailCreditMetering,
        mailboxLimit: Number(form.mailboxLimit),
        emailCampaignLimit: Number(form.emailCampaignLimit),
        plan: form.plan,
        monthlyQuota: Number(form.monthlyQuota),
        dailyBatchSize: Number(form.dailyBatchSize),
        batchWindowDays: Number(form.batchWindowDays),
        stageIntervalDays: Number(form.stageIntervalDays),
        followUpCount: Number(form.followUpCount),
        workDays: form.workDays,
        emailJitterSeconds: Number(form.emailJitterSeconds),
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

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <label className="label">Assigned salesperson</label>
        <div className="flex items-center gap-2">
          <select
            className="input flex-1"
            value={salesPersonId}
            onChange={(e) => { setSalesPersonId(e.target.value); setSalesMsg(''); }}
          >
            <option value="">— Unassigned —</option>
            {salesPersons.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
            ))}
          </select>
          <button type="button" className="btn-ghost" disabled={salesBusy} onClick={saveSalesperson}>
            {salesBusy ? '…' : 'Save'}
          </button>
          {salesMsg && <span className={`text-xs ${salesMsg === 'Saved' ? 'text-emerald-600' : 'text-rose-600'}`}>{salesMsg}</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">The salesperson sees this client and handles its support tickets.</p>
      </div>

      {/* Operation contacts — cc'd on the monthly campaign-data reminder */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="label mb-0">Operation contacts</label>
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline"
            onClick={() => setOpsContacts([...opsContacts, { name: '', email: '' }])}>
            + Add
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-400">
          Ops people who get the monthly reminder to add the next 80–100 buyers/suppliers (alongside the salesperson).
        </p>
        {opsContacts.length === 0 && <p className="text-xs text-slate-400">No operation contacts yet.</p>}
        <div className="space-y-2">
          {opsContacts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input flex-1" placeholder="Name" value={o.name}
                onChange={(e) => setOpsContacts(opsContacts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <input className="input flex-[2]" placeholder="email@company.com" value={o.email}
                onChange={(e) => setOpsContacts(opsContacts.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
              <button type="button" className="text-rose-500 hover:text-rose-700"
                onClick={() => setOpsContacts(opsContacts.filter((_, j) => j !== i))} title="Remove">✕</button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-ghost" disabled={opsBusy} onClick={saveOps}>
            {opsBusy ? '…' : 'Save contacts'}
          </button>
          <button type="button" className="btn-ghost" disabled={opsBusy} onClick={sendOpsTest} title="Send the monthly reminder now to check recipients + mailbox">
            ✉ Send test mail
          </button>
          {opsMsg && <span className={`text-xs ${opsMsg.startsWith('Saved') || opsMsg.startsWith('Test sent') ? 'text-emerald-600' : 'text-rose-600'}`}>{opsMsg}</span>}
        </div>
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
              onChange={(e) => {
                const name = e.target.value;
                const p = plans.find((pl) => pl.name === name);
                setForm((f) => ({ ...f, plan: name, ...(p ? { validityDays: p.validityDays ?? 0, emailCredits: p.emailCredits ?? 0, mailboxLimit: p.mailboxLimit ?? 0, emailCampaignLimit: p.emailCampaignLimit ?? 0 } : {}) }));
                if (p) setLiPlan((lp) => ({ ...lp, seats: p.seatLimit || lp.seats, credits: p.linkedInCredits ?? 0, campaignLimit: p.linkedInCampaignLimit ?? 0 }));
              }}>
              {planOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <PlanAllowance plan={plans.find((p) => p.name === form.plan)} />
          </div>
          <div>
            <label className="label">Validity (days)</label>
            <input className="input" type="number" min={0} value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Math.max(0, Number(e.target.value) || 0) })} placeholder="0 = no expiry" />
            <p className="mt-0.5 text-[11px] text-slate-400">Changing this restarts the validity window from today.</p>
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
        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Credits" value={form.emailCredits} onChange={(v) => setForm({ ...form, emailCredits: v })} />
            <NumberField label="Mailboxes (0=∞)" value={form.mailboxLimit} onChange={(v) => setForm({ ...form, mailboxLimit: v })} />
            <NumberField label="Campaigns (0=∞)" value={form.emailCampaignLimit} onChange={(v) => setForm({ ...form, emailCampaignLimit: v })} />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.emailCreditMetering} onChange={(e) => setForm({ ...form, emailCreditMetering: e.target.checked })} />
            Meter email sends — <strong>1 credit per email</strong> (off = unlimited)
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField label="Contacts / month" value={form.monthlyQuota} onChange={(v) => setForm({ ...form, monthlyQuota: v })} />
          <NumberField label="Sends / day" value={form.dailyBatchSize} onChange={(v) => setForm({ ...form, dailyBatchSize: v })} />
          <NumberField label="Batch window (days)" value={form.batchWindowDays} onChange={(v) => setForm({ ...form, batchWindowDays: v })} />
          <NumberField label="Gap between stages (days)" value={form.stageIntervalDays} onChange={(v) => setForm({ ...form, stageIntervalDays: v })} />
          <NumberField label="Follow-ups (after initial)" value={form.followUpCount} onChange={(v) => setForm({ ...form, followUpCount: v })} />
          <HourField label="Send window start" value={form.sendWindowStart} onChange={(v) => setForm({ ...form, sendWindowStart: v })} />
          <HourField label="Send window end" value={form.sendWindowEnd} onChange={(v) => setForm({ ...form, sendWindowEnd: v })} />
          <NumberField label="Interval jitter (± days)" value={form.stageIntervalJitterDays} onChange={(v) => setForm({ ...form, stageIntervalJitterDays: v })} />
          <NumberField label="Send stagger (± sec)" value={form.emailJitterSeconds} onChange={(v) => setForm({ ...form, emailJitterSeconds: v })} />
          <DaysField label="Send days" value={form.workDays} onChange={(v) => setForm({ ...form, workDays: v })} />
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
            <div className="relative">
              <input type={showLoginPw ? 'text' : 'password'} className="input pr-16" value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)} placeholder="Min 6 characters" />
              <button type="button" onClick={() => setShowLoginPw((s) => !s)}
                className="absolute inset-y-0 right-2 my-auto h-6 text-xs font-medium text-slate-500 hover:text-slate-700">
                {showLoginPw ? 'Hide' : 'Show'}
              </button>
            </div>
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

// ── Bulk assign / unassign a salesperson across several clients ──
function BulkAssignSalesperson({
  clients,
  onClose,
  onDone,
}: {
  clients: Client[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [persons, setPersons] = useState<{ id: string; name: string; email: string }[]>([]);
  const [salesPersonId, setSalesPersonId] = useState<string>('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ id: string; name: string; email: string }[]>('/sales/persons').then(setPersons).catch(() => {});
  }, []);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (picked.size === 0) { setErr('Select at least one client.'); return; }
    setBusy(true); setErr('');
    try {
      await api.post('/sales/assign', {
        salesPersonId: salesPersonId || null,
        clientIds: [...picked],
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-slate-800">Assign salesperson</h2>
        <p className="mb-4 text-xs text-slate-500">
          Pick a salesperson (or leave as “Unassign”), then choose the clients to apply it to.
        </p>
        {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Salesperson</span>
          <select
            value={salesPersonId}
            onChange={(e) => setSalesPersonId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="">— Unassign —</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
            ))}
          </select>
        </label>
        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
          {clients.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-slate-400">No clients in view.</div>
          ) : (
            clients.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="flex-1 truncate text-slate-700">{c.name}</span>
                <span className="text-xs text-slate-400">{c.salesPerson?.name ?? 'Unassigned'}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{picked.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button disabled={busy} onClick={apply} className="btn-primary disabled:opacity-50">
              {busy ? 'Applying…' : salesPersonId ? 'Assign' : 'Unassign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
