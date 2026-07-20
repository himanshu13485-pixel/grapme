'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Channels } from '@/components/Channels';

interface ClientDetail {
  id: string; name: string; contactPerson: string | null; email: string | null; mobile: string | null;
  status: string; plan: string; emailEnabled: boolean; linkedInEnabled: boolean;
  invoiceNo: string | null; productCategory: string | null; serviceType: string | null;
  validityEndAt: string | null;
}
interface Stats { emailCampaigns: number; cohorts: number; contacts: number; liCampaigns: number; liLeads: number }

type Tab = 'overview' | 'email' | 'linkedin' | 'contacts';

export default function SalesClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<ClientDetail>(`/sales/my/clients/${id}`).then(setClient).catch(() => setErr('This client is not assigned to you.'));
    api.get<Stats>(`/sales/my/clients/${id}/stats`).then(setStats).catch(() => {});
  }, [id]);

  if (err) return <div className="mx-auto max-w-5xl"><button onClick={() => router.push('/sales-clients')} className="mb-4 text-sm text-brand-700">← Back</button><div className="text-rose-600">{err}</div></div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'email', label: 'Email' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'contacts', label: 'Contacts' },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => router.push('/sales-clients')} className="mb-4 text-sm font-medium text-brand-700">← My Clients</button>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{client?.name ?? '…'}</h1>
        {client && <Channels email={client.emailEnabled} linkedIn={client.linkedInEnabled} />}
      </div>
      <p className="mb-5 text-sm text-slate-500">Read-only view of this client&apos;s outreach activity.</p>

      {/* stat row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Campaigns" value={stats?.emailCampaigns} />
        <Stat label="Cohorts" value={stats?.cohorts} />
        <Stat label="Contacts" value={stats?.contacts} />
        <Stat label="LI campaigns" value={stats?.liCampaigns} />
        <Stat label="LI leads" value={stats?.liLeads} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && client && <Overview client={client} />}
      {tab === 'email' && <EmailTab id={id} />}
      {tab === 'linkedin' && <LinkedInTab id={id} />}
      {tab === 'contacts' && <ContactsTab id={id} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-slate-800">{value ?? '—'}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function Overview({ client }: { client: ClientDetail }) {
  const rows: [string, string | null][] = [
    ['Contact person', client.contactPerson],
    ['Email', client.email],
    ['Mobile', client.mobile],
    ['Invoice / Ref', client.invoiceNo],
    ['Product category', client.productCategory],
    ['Service type', client.serviceType],
    ['Plan', client.plan],
    ['Status', client.status],
    ['Valid until', client.validityEndAt ? new Date(client.validityEndAt).toLocaleDateString() : null],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="w-1/3 bg-slate-50 px-4 py-2.5 font-medium text-slate-500">{k}</td>
              <td className="px-4 py-2.5 text-slate-800">{v || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

function usePaged<T>(path: string, pageSize = 20) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<T> | null>(null);
  const load = useCallback(() => {
    setData(null);
    api.get<Paged<T>>(`${path}?page=${page}&pageSize=${pageSize}`).then(setData).catch(() => setData({ items: [], total: 0, page, pageSize }));
  }, [path, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  return { rows: data ? data.items : null, total: data?.total ?? 0, page, setPage, pageSize, loading: data === null };
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Prev</button>
        <span className="px-2">Page {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function Table({ head, children, empty, loading }: { head: string[]; children: React.ReactNode; empty?: boolean; loading: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? <tr><td colSpan={head.length} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            : empty ? <tr><td colSpan={head.length} className="px-4 py-8 text-center text-slate-400">Nothing here yet.</td></tr>
            : children}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{s}</span>;
}

interface Campaign { id: string; name: string; status: string; startAt: string | null; createdAt: string }
interface Cohort { id: string; label: string; status: string; monthIndex: number; startDate: string; endedAt: string | null }

function EmailTab({ id }: { id: string }) {
  const campaigns = usePaged<Campaign>(`/sales/my/clients/${id}/campaigns`);
  const cohorts = usePaged<Cohort>(`/sales/my/clients/${id}/cohorts`);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Campaigns</h3>
        <Table head={['Name', 'Status', 'Start', 'Created']} loading={campaigns.loading} empty={campaigns.rows?.length === 0}>
          {campaigns.rows?.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
              <td className="px-4 py-2.5"><StatusPill s={c.status} /></td>
              <td className="px-4 py-2.5 text-slate-500">{c.startAt ? new Date(c.startAt).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-2.5 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </Table>
        <Pager page={campaigns.page} pageSize={campaigns.pageSize} total={campaigns.total} onPage={campaigns.setPage} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Cohorts</h3>
        <Table head={['Cohort', 'Month', 'Status', 'Started']} loading={cohorts.loading} empty={cohorts.rows?.length === 0}>
          {cohorts.rows?.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">{c.label}</td>
              <td className="px-4 py-2.5 text-slate-500">#{c.monthIndex}</td>
              <td className="px-4 py-2.5"><StatusPill s={c.status} /></td>
              <td className="px-4 py-2.5 text-slate-500">{new Date(c.startDate).toLocaleDateString()}</td>
            </tr>
          ))}
        </Table>
        <Pager page={cohorts.page} pageSize={cohorts.pageSize} total={cohorts.total} onPage={cohorts.setPage} />
      </div>
    </div>
  );
}

interface LiCampaign { id: string; name: string; status: string; createdAt: string }
interface LiLead { id: string; fullName: string; title: string | null; company: string | null; location: string | null; status: string; connectedAt: string | null; profileUrl: string | null }

function LinkedInTab({ id }: { id: string }) {
  const campaigns = usePaged<LiCampaign>(`/sales/my/clients/${id}/li-campaigns`);
  const leads = usePaged<LiLead>(`/sales/my/clients/${id}/li-leads`);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">LinkedIn campaigns</h3>
        <Table head={['Name', 'Status', 'Created']} loading={campaigns.loading} empty={campaigns.rows?.length === 0}>
          {campaigns.rows?.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
              <td className="px-4 py-2.5"><StatusPill s={c.status} /></td>
              <td className="px-4 py-2.5 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </Table>
        <Pager page={campaigns.page} pageSize={campaigns.pageSize} total={campaigns.total} onPage={campaigns.setPage} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Leads</h3>
        <Table head={['Name', 'Title', 'Company', 'Status']} loading={leads.loading} empty={leads.rows?.length === 0}>
          {leads.rows?.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">
                {l.profileUrl ? <a href={l.profileUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{l.fullName}</a> : l.fullName}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{l.title || '—'}</td>
              <td className="px-4 py-2.5 text-slate-600">{l.company || '—'}</td>
              <td className="px-4 py-2.5"><StatusPill s={l.status} /></td>
            </tr>
          ))}
        </Table>
        <Pager page={leads.page} pageSize={leads.pageSize} total={leads.total} onPage={leads.setPage} />
      </div>
    </div>
  );
}

interface Contact { id: string; email: string; firstName: string | null; lastName: string | null; company: string | null; country: string | null; status: string }

function ContactsTab({ id }: { id: string }) {
  const contacts = usePaged<Contact>(`/sales/my/clients/${id}/contacts`);
  return (
    <div>
      <Table head={['Email', 'Name', 'Company', 'Country', 'Status']} loading={contacts.loading} empty={contacts.rows?.length === 0}>
        {contacts.rows?.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2.5 text-slate-800">{c.email}</td>
            <td className="px-4 py-2.5 text-slate-600">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{c.company || '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{c.country || '—'}</td>
            <td className="px-4 py-2.5"><StatusPill s={c.status} /></td>
          </tr>
        ))}
      </Table>
      <Pager page={contacts.page} pageSize={contacts.pageSize} total={contacts.total} onPage={contacts.setPage} />
    </div>
  );
}
