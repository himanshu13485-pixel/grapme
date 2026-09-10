'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { SalesActivityDashboard } from '@/components/SalesActivityDashboard';
import { CategoryBadge } from '@/components/ui';
import { cohortRef } from '@/lib/cohorts';

/* ─────────────────────────── types ─────────────────────────── */
interface ClientDetail {
  id: string; name: string; contactPerson: string | null; email: string | null; mobile: string | null;
  status: string; plan: string; emailEnabled: boolean; linkedInEnabled: boolean;
  invoiceNo: string | null; productCategory: string | null; serviceType: string | null;
  validityStartAt: string | null; validityEndAt: string | null; createdAt: string;
}
interface Stats { emailCampaigns: number; cohorts: number; contacts: number; liCampaigns: number; liLeads: number }
interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

/* ─────────────────────────── data hooks ─────────────────────────── */
function usePaged<T>(path: string, pageSize = 20) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<T> | null>(null);
  const load = useCallback(() => {
    setData(null);
    api.get<Paged<T>>(`${path}?page=${page}&pageSize=${pageSize}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page, pageSize }));
  }, [path, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  return { rows: data ? data.items : null, total: data?.total ?? 0, page, setPage, pageSize, loading: data === null };
}

function useList<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => { setRows(null); api.get<T[]>(path).then(setRows).catch(() => setRows([])); }, [path]);
  return rows;
}

/* ─────────────────────────── page ─────────────────────────── */
type Channel = 'email' | 'linkedin';

export default function SalesClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [channel, setChannel] = useState<Channel>('email');

  useEffect(() => {
    api.get<ClientDetail>(`/sales/my/clients/${id}`)
      .then((c) => { setClient(c); setChannel(c.emailEnabled !== false ? 'email' : 'linkedin'); })
      .catch(() => setErr('This client is not assigned to you.'));
    api.get<Stats>(`/sales/my/clients/${id}/stats`).then(setStats).catch(() => {});
  }, [id]);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl">
        <button onClick={() => router.push('/sales-clients')} className="mb-4 text-sm text-brand-700">← My Clients</button>
        <div className="text-rose-600">{err}</div>
      </div>
    );
  }

  const expired = client?.validityEndAt && new Date(client.validityEndAt) < new Date();
  const daysLeft = client?.validityEndAt
    ? Math.ceil((new Date(client.validityEndAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <button onClick={() => router.push('/sales-clients')} className="mb-3 text-sm font-medium text-brand-700">← My Clients</button>

      {/* header — mirrors the admin client workspace header, minus the actions */}
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">{client?.name ?? '…'}</h1>
            <CategoryBadge category={client?.productCategory} />
          </div>
          <p className="text-xs text-slate-500">
            {client?.plan}
            {client?.contactPerson ? ` · ${client.contactPerson}` : ''}
            {client?.email ? ` · ${client.email}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${(client?.status ?? 'active') === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            ● {client?.status ?? '—'}
          </span>
          {client?.validityEndAt && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${expired ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
              ⌛ {expired ? 'Expired' : `${daysLeft} days left`} · {new Date(client.validityEndAt).toLocaleDateString()}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">Read-only</span>
        </div>
      </div>

      {/* channel switch — same shape as the admin Email / LinkedIn toggle */}
      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(['email', 'linkedin'] as Channel[]).map((ch) => {
          const enabled = ch === 'email' ? client?.emailEnabled !== false : !!client?.linkedInEnabled;
          return (
            <button
              key={ch}
              disabled={!enabled}
              onClick={() => setChannel(ch)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                channel === ch ? 'bg-brand-gradient text-white shadow-sm' : enabled ? 'text-slate-600 hover:bg-slate-50' : 'cursor-not-allowed text-slate-300'
              }`}
            >
              {ch === 'email' ? '📧 Email' : '🔗 LinkedIn'}
            </button>
          );
        })}
      </div>

      {channel === 'email' ? <EmailSide id={id} stats={stats} /> : <LinkedInSide id={id} stats={stats} />}
    </div>
  );
}

/* ─────────────────────────── Email side ─────────────────────────── */
type EmailTab = 'mailboxes' | 'sequence' | 'cohorts' | 'contacts' | 'templates' | 'campaigns';

function EmailSide({ id, stats }: { id: string; stats: Stats | null }) {
  const [tab, setTab] = useState<EmailTab>('mailboxes');
  const [scopeCampaign, setScopeCampaign] = useState(''); // '' = whole client
  const [allCampaigns, setAllCampaigns] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.get<Paged<{ id: string; name: string }>>(`/sales/my/clients/${id}/campaigns?page=1&pageSize=100`)
      .then((r) => setAllCampaigns(r.items))
      .catch(() => setAllCampaigns([]));
  }, [id]);
  const mailboxes = useList<{ id: string; label: string; emailAddress: string; status: string; dailyLimit: number }>(`/sales/my/clients/${id}/mailboxes`);
  const sequence = useList<{ id: string; stageOrder: number; waitDays: number; monthOffset: number }>(`/sales/my/clients/${id}/sequence`);
  const templates = useList<{ id: string; name: string; subject: string; updatedAt: string }>(`/sales/my/clients/${id}/templates`);

  const tabs: { key: EmailTab; label: string; count?: number }[] = [
    { key: 'mailboxes', label: 'Mailboxes', count: mailboxes?.length },
    { key: 'sequence', label: 'Sequence', count: sequence?.length },
    { key: 'cohorts', label: 'Cohorts', count: stats?.cohorts },
    { key: 'contacts', label: 'Contacts', count: stats?.contacts },
    { key: 'templates', label: 'Templates', count: templates?.length },
    { key: 'campaigns', label: 'Campaigns', count: stats?.emailCampaigns },
  ];

  return (
    <div>
      {/* Activity — whole client, or one campaign */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Activity</h3>
        <select className="input w-full max-w-xs" value={scopeCampaign} onChange={(e) => setScopeCampaign(e.target.value)}>
          <option value="">Whole client (all campaigns)</option>
          {allCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="mb-6">
        <SalesActivityDashboard clientId={id} campaignId={scopeCampaign || undefined} show="email" />
      </div>

      <SubTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as EmailTab)} />
      {tab === 'mailboxes' && (
        <Table head={['Label', 'Address', 'Daily limit', 'Status']} loading={mailboxes === null} empty={mailboxes?.length === 0} emptyText="No mailboxes connected yet.">
          {mailboxes?.map((m) => (
            <tr key={m.id}>
              <td className="p-3 font-medium text-slate-800">{m.label}</td>
              <td className="p-3 text-slate-600">{m.emailAddress}</td>
              <td className="p-3 text-slate-600">{m.dailyLimit}</td>
              <td className="p-3"><Pill s={m.status} /></td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'sequence' && (
        <Table head={['Stage', 'Wait (days)', 'Month']} loading={sequence === null} empty={sequence?.length === 0} emptyText="No sequence configured.">
          {sequence?.map((s) => (
            <tr key={s.id}>
              <td className="p-3 font-medium text-slate-800">{s.stageOrder === 0 ? 'Initial' : `Follow-up ${s.stageOrder}`}</td>
              <td className="p-3 text-slate-600">{s.waitDays}</td>
              <td className="p-3 text-slate-600">{s.monthOffset}</td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'cohorts' && <CohortsTab id={id} />}
      {tab === 'contacts' && <ContactsTab id={id} />}
      {tab === 'templates' && (
        <Table head={['Name', 'Subject', 'Updated']} loading={templates === null} empty={templates?.length === 0} emptyText="No templates yet.">
          {templates?.map((t) => (
            <tr key={t.id}>
              <td className="p-3 font-medium text-slate-800">{t.name}</td>
              <td className="p-3 text-slate-600">{t.subject}</td>
              <td className="p-3 text-slate-500">{new Date(t.updatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'campaigns' && <CampaignsTab id={id} />}
    </div>
  );
}

/* ─────────────────────────── LinkedIn side ─────────────────────────── */
type LiTab = 'accounts' | 'campaigns' | 'leads';
interface LiAccount { id: string; fullName: string | null; headline: string | null; status: string; connectionsCount: number | null; lastSyncedAt: string | null }
interface LiSub { planName: string | null; seats: number; creditsBalance: number; campaignLimit: number; validityDays: number | null; validityStartAt: string | null }

function LinkedInSide({ id, stats }: { id: string; stats: Stats | null }) {
  const [tab, setTab] = useState<LiTab>('accounts');
  const [li, setLi] = useState<{ accounts: LiAccount[]; subscription: LiSub | null } | null>(null);
  const [scopeCampaign, setScopeCampaign] = useState(''); // '' = whole client
  const [liCampaignOptions, setLiCampaignOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get<{ accounts: LiAccount[]; subscription: LiSub | null }>(`/sales/my/clients/${id}/linkedin`).then(setLi).catch(() => setLi({ accounts: [], subscription: null })); }, [id]);
  useEffect(() => {
    api.get<Paged<{ id: string; name: string }>>(`/sales/my/clients/${id}/li-campaigns?page=1&pageSize=100`)
      .then((r) => setLiCampaignOptions(r.items))
      .catch(() => setLiCampaignOptions([]));
  }, [id]);

  const sub = li?.subscription;
  const daysLeft = sub?.validityStartAt && sub.validityDays
    ? Math.max(0, Math.ceil((new Date(sub.validityStartAt).getTime() + sub.validityDays * 86_400_000 - Date.now()) / 86_400_000))
    : null;

  const tabs: { key: LiTab; label: string; count?: number }[] = [
    { key: 'accounts', label: 'Accounts', count: li?.accounts.length },
    { key: 'campaigns', label: 'Campaigns', count: stats?.liCampaigns },
    { key: 'leads', label: 'Leads', count: stats?.liLeads },
  ];

  return (
    <div>
      {/* Plan KPIs — same four as the admin LinkedIn tab */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Seats" value={sub?.seats} />
        <Kpi label="Credits" value={sub?.creditsBalance} />
        <Kpi label="Plan validity (days)" value={sub?.validityDays ?? undefined} sub={daysLeft != null ? `${daysLeft} days left` : undefined} />
        <Kpi label="Campaign limit" value={sub?.campaignLimit} sub={sub?.campaignLimit === 0 ? 'unlimited' : undefined} />
      </div>

      {/* Activity — whole client, or one campaign */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Activity</h3>
        <select className="input w-full max-w-xs" value={scopeCampaign} onChange={(e) => setScopeCampaign(e.target.value)}>
          <option value="">Whole client (all campaigns)</option>
          {liCampaignOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="mb-6">
        <SalesActivityDashboard clientId={id} liCampaignId={scopeCampaign || undefined} show="linkedin" />
      </div>

      <SubTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as LiTab)} />
      {tab === 'accounts' && (
        <Table head={['Name', 'Headline', 'Connections', 'Status']} loading={li === null} empty={li?.accounts.length === 0} emptyText="No LinkedIn seats connected.">
          {li?.accounts.map((a) => (
            <tr key={a.id}>
              <td className="p-3 font-medium text-slate-800">{a.fullName ?? '—'}</td>
              <td className="p-3 text-slate-600"><div className="max-w-[320px] truncate" title={a.headline ?? ''}>{a.headline ?? '—'}</div></td>
              <td className="p-3 text-slate-600">{a.connectionsCount ?? '—'}</td>
              <td className="p-3"><Pill s={a.status} /></td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'campaigns' && <LiCampaignsTab id={id} />}
      {tab === 'leads' && <LiLeadsTab id={id} />}
    </div>
  );
}

/* ─────────────────────────── paged tabs ─────────────────────────── */
interface Campaign { id: string; name: string; status: string; startAt: string | null; createdAt: string }
function CampaignsTab({ id }: { id: string }) {
  const p = usePaged<Campaign>(`/sales/my/clients/${id}/campaigns`);
  return (
    <>
      <Table head={['Name', 'Status', 'Start', 'Created']} loading={p.loading} empty={p.rows?.length === 0} emptyText="No campaigns yet.">
        {p.rows?.map((c) => (
          <tr key={c.id}>
            <td className="p-3 font-medium text-slate-800">{c.name}</td>
            <td className="p-3"><Pill s={c.status} /></td>
            <td className="p-3 text-slate-500">{c.startAt ? new Date(c.startAt).toLocaleDateString() : '—'}</td>
            <td className="p-3 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </Table>
      <Pager {...p} />
    </>
  );
}

interface Cohort { id: string; label: string; status: string; monthIndex: number; subIndex?: number | null; startDate: string }
function CohortsTab({ id }: { id: string }) {
  const p = usePaged<Cohort>(`/sales/my/clients/${id}/cohorts`);
  return (
    <>
      <Table head={['Cohort', 'Month', 'Status', 'Started']} loading={p.loading} empty={p.rows?.length === 0} emptyText="No cohorts yet.">
        {p.rows?.map((c) => (
          <tr key={c.id}>
            <td className="p-3 font-medium text-slate-800">{c.label}</td>
            <td className="p-3 text-slate-500">{cohortRef(c.monthIndex, c.subIndex)}</td>
            <td className="p-3"><Pill s={c.status} /></td>
            <td className="p-3 text-slate-500">{new Date(c.startDate).toLocaleDateString()}</td>
          </tr>
        ))}
      </Table>
      <Pager {...p} />
    </>
  );
}

interface Contact { id: string; email: string; firstName: string | null; lastName: string | null; company: string | null; country: string | null; status: string }
function ContactsTab({ id }: { id: string }) {
  const p = usePaged<Contact>(`/sales/my/clients/${id}/contacts`);
  return (
    <>
      <Table head={['Email', 'Name', 'Company', 'Country', 'Status']} loading={p.loading} empty={p.rows?.length === 0} emptyText="No contacts yet.">
        {p.rows?.map((c) => (
          <tr key={c.id}>
            <td className="p-3 text-slate-800">{c.email}</td>
            <td className="p-3 text-slate-600">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
            <td className="p-3 text-slate-600">{c.company || '—'}</td>
            <td className="p-3 text-slate-600">{c.country || '—'}</td>
            <td className="p-3"><Pill s={c.status} /></td>
          </tr>
        ))}
      </Table>
      <Pager {...p} />
    </>
  );
}

interface LiCampaign { id: string; name: string; status: string; createdAt: string }
function LiCampaignsTab({ id }: { id: string }) {
  const p = usePaged<LiCampaign>(`/sales/my/clients/${id}/li-campaigns`);
  return (
    <>
      <Table head={['Name', 'Status', 'Created']} loading={p.loading} empty={p.rows?.length === 0} emptyText="No LinkedIn campaigns yet.">
        {p.rows?.map((c) => (
          <tr key={c.id}>
            <td className="p-3 font-medium text-slate-800">{c.name}</td>
            <td className="p-3"><Pill s={c.status} /></td>
            <td className="p-3 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </Table>
      <Pager {...p} />
    </>
  );
}

interface LiLead { id: string; fullName: string; title: string | null; company: string | null; status: string; profileUrl: string | null }
function LiLeadsTab({ id }: { id: string }) {
  const p = usePaged<LiLead>(`/sales/my/clients/${id}/li-leads`);
  return (
    <>
      <Table head={['Name', 'Title', 'Company', 'Status']} loading={p.loading} empty={p.rows?.length === 0} emptyText="No leads yet.">
        {p.rows?.map((l) => (
          <tr key={l.id}>
            <td className="p-3 font-medium text-slate-800">
              {l.profileUrl ? <a href={l.profileUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{l.fullName}</a> : l.fullName}
            </td>
            <td className="p-3 text-slate-600"><div className="max-w-[280px] truncate" title={l.title ?? ''}>{l.title || '—'}</div></td>
            <td className="p-3 text-slate-600">{l.company || '—'}</td>
            <td className="p-3"><Pill s={l.status} /></td>
          </tr>
        ))}
      </Table>
      <Pager {...p} />
    </>
  );
}

/* ─────────────────────────── shared bits ─────────────────────────── */
function SubTabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium ${active === t.key ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function Table({ head, children, empty, loading, emptyText }: { head: string[]; children: React.ReactNode; empty?: boolean; loading: boolean; emptyText?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>{head.map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {loading ? <tr><td colSpan={head.length} className="p-8 text-center text-slate-400">Loading…</td></tr>
            : empty ? <tr><td colSpan={head.length} className="p-8 text-center text-slate-400">{emptyText ?? 'Nothing here yet.'}</td></tr>
            : children}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, pageSize, total, setPage }: { page: number; pageSize: number; total: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Prev</button>
        <span className="px-2">Page {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value ?? '—'}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Pill({ s }: { s: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{s}</span>;
}
