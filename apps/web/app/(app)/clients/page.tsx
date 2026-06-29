'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader, EmptyState, Modal, StatusBadge } from '@/components/ui';

interface Client {
  id: string;
  name: string;
  invoiceNo?: string;
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
  _count?: { mailboxes: number; cohorts: number; enrollments: number };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [show, setShow] = useState(false);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [q, setQ] = useState('');
  const [invoiceQ, setInvoiceQ] = useState('');

  function load() {
    api.get<Client[]>('/clients').then(setClients).catch(() => {});
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inv = invoiceQ.trim().toLowerCase();
    return clients.filter((c) => {
      if (inv && !(c.invoiceNo ?? '').toLowerCase().includes(inv)) return false;
      if (!s) return true;
      return [c.name, c.plan, c.invoiceNo]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(s));
    });
  }, [clients, q, invoiceQ]);

  return (
    <div>
      <PageHeader
        title="Clients Workspace"
        subtitle="Each client runs its own mailbox group, sequence, and monthly cohorts"
        action={
          <button className="btn-primary" onClick={() => setShow(true)}>
            + New client
          </button>
        }
      />

      {clients.length === 0 ? (
        <EmptyState message="No clients yet. Create one to set up its mailbox group and outreach." />
      ) : (
        <>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Search by company / plan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <input
            className="input w-48"
            placeholder="Filter by invoice no.…"
            value={invoiceQ}
            onChange={(e) => setInvoiceQ(e.target.value)}
          />
          <span className="ml-auto text-sm text-slate-400">
            {filtered.length} of {clients.length}
          </span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState message="No clients match your search." />
        ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="card p-5 transition hover:border-brand-300 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium text-slate-800">{c.name}</div>
                <StatusBadge status={c.status === 'active' ? 'ACTIVE' : c.status} />
              </div>
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
              </div>
            </Link>
          ))}
        </div>
        )}
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
    </div>
  );
}

function ClientDetailView({ client }: { client: Client }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Company name', value: client.name },
    { label: 'Invoice no.', value: client.invoiceNo || '—' },
    { label: 'Plan', value: client.plan },
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

function NewClientForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '',
    invoiceNo: '',
    plan: 'GROWTH',
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/clients', {
        ...form,
        invoiceNo: form.invoiceNo || undefined,
        monthlyQuota: Number(form.monthlyQuota),
        dailyBatchSize: Number(form.dailyBatchSize),
        batchWindowDays: Number(form.batchWindowDays),
        stageIntervalDays: Number(form.stageIntervalDays),
        followUpCount: Number(form.followUpCount),
        sendWindowStart: Number(form.sendWindowStart),
        sendWindowEnd: Number(form.sendWindowEnd),
        stageIntervalJitterDays: Number(form.stageIntervalJitterDays),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
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
          <label className="label">Plan</label>
          <select
            className="input"
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
          >
            <option value="GROWTH">Growth</option>
            <option value="GROWTH_PLUS">Growth Plus</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>
        </div>
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
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Creating…' : 'Create client'}
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
