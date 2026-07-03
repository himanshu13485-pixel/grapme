'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ValidityBadge } from '@/components/Validity';

interface Client {
  id: string;
  name: string;
  status: string;
  plan: string;
  serviceType?: string | null;
  validityDays?: number | null;
  validityStartAt?: string | null;
  dailyBatchSize: number;
  monthlyQuota: number;
  followUpCount: number;
  _count?: { mailboxes: number; cohorts: number; enrollments: number };
}

export default function ClientHomePage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get<Client[]>('/clients')
      .then(setClients)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const totals = clients.reduce(
    (acc, c) => {
      acc.mailboxes += c._count?.mailboxes ?? 0;
      acc.cohorts += c._count?.cohorts ?? 0;
      acc.contacts += c._count?.enrollments ?? 0;
      return acc;
    },
    { mailboxes: 0, cohorts: 0, contacts: 0 },
  );

  return (
    <div>
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name}` : ''}`}
        subtitle="Your outreach at a glance"
      />

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Profiles" value={clients.length} />
        <Tile label="Mailboxes" value={totals.mailboxes} />
        <Tile label="Cohorts" value={totals.cohorts} />
        <Tile label="Contacts" value={totals.contacts} />
      </div>

      {loaded && clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="mb-4 text-slate-500">
            You don&apos;t have a workspace yet. Set one up to start your outreach.
          </p>
          <Link
            href="/clients?new=1"
            className="inline-block rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110"
          >
            + Set up my workspace
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {clients.map((c) => {
            const active = (c.status ?? 'active').toLowerCase() === 'active';
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-800">{c.name}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {c.plan}
                      {c.serviceType ? ` · ${labelService(c.serviceType)}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="mt-3">
                  <ValidityBadge days={c.validityDays} startAt={c.validityStartAt} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <MiniStat label="Mailboxes" value={c._count?.mailboxes ?? 0} />
                  <MiniStat label="Cohorts" value={c._count?.cohorts ?? 0} />
                  <MiniStat label="Contacts" value={c._count?.enrollments ?? 0} />
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {c.dailyBatchSize}/day · {c.followUpCount} follow-ups · {c.monthlyQuota}/mo
                  </span>
                  <Link
                    href={`/clients/${c.id}`}
                    className="font-medium text-emerald-600 hover:underline"
                  >
                    Open workspace →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelService(s: string): string {
  if (s === 'EXPORT') return 'Export';
  if (s === 'IMPORT') return 'Import';
  if (s === 'BOTH') return 'Export & Import';
  return s;
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-lg font-semibold text-slate-800">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
