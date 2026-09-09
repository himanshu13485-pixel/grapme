'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, useCanDelete } from '@/lib/auth';
import { PageHeader, EmptyState, Modal, CategoryBadge } from '@/components/ui';
import { SetupMonthSquares, SetupMonthLegend } from '@/components/SetupMonthSquares';

type Group = 'GENERAL' | 'EMAIL' | 'LINKEDIN' | 'MONTHLY';
type Status = 'NOT_STARTED' | 'STARTED' | 'FINISHED';

interface Progress { total: number; finished: number; started: number; percent: number }
interface MonthCell { i: number; status: Status }
interface ClientRow {
  id: string; name: string; invoiceNo?: string | null; invoiceDate?: string | null; plan: string; status: string;
  productCategory?: string | null;
  emailEnabled: boolean; linkedInEnabled: boolean;
  salesPerson?: { id: string; name: string } | null;
  progress: Progress;
  months?: MonthCell[];
  setupStartedAt?: string | null;
  setupFinishedAt?: string | null;
}
interface StepEvent { id: string; status: Status; actorName: string; at: string }
interface Step {
  id: string; templateKey: string | null; label: string; group: Group; order: number; status: Status; hidden: boolean;
  assigneeUserId: string | null; assigneeName: string | null; assigneeEmail: string | null; assigneeRole: string | null;
  startedAt: string | null; finishedAt: string | null; updatedByName: string | null; updatedAt: string;
  events?: StepEvent[];
}
interface Detail { client: { id: string; name: string; emailEnabled: boolean; linkedInEnabled: boolean; serviceMonths: number; setupNotifiedAt: string | null }; progress: Progress; steps: Step[] }
interface Member { id: string; name: string; email: string; role: string }
interface TemplateStep { id: string; key: string; label: string; group: Group; order: number; active: boolean }

const GROUP_LABEL: Record<Group, string> = { GENERAL: 'General', EMAIL: 'Email Setup', LINKEDIN: 'LinkedIn Setup', MONTHLY: 'Monthly Email Arrangement (internal)' };
const GROUP_ORDER: Group[] = ['GENERAL', 'EMAIL', 'LINKEDIN', 'MONTHLY'];
// MONTHLY steps are auto-generated from months-of-service, so they can't be added by hand.
const ADDABLE_GROUPS: Group[] = ['GENERAL', 'EMAIL', 'LINKEDIN'];
const emptyGroups = <T,>(): Record<Group, T[]> => ({ GENERAL: [], EMAIL: [], LINKEDIN: [], MONTHLY: [] });
const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
  NOT_STARTED: { label: 'Not Yet Started', cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  STARTED: { label: 'Process Started', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  FINISHED: { label: 'Process Finished', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
};
const roleLabel = (r: string) => r === 'SUPER_ADMIN' ? 'Admin' : r === 'SUB_ADMIN' ? 'Sub-admin' : r === 'SALES' ? 'Salesperson' : 'Staff';

/** Formats a millisecond span as `days:hh:mm:ss` (e.g. "2d 03:15:42"). */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${days}d ${hh}:${mm}:${ss}`;
}

/** Onboarding stopwatch: live-ticks from workspace creation, freezes on 100%.
 *  Shown on the Reporting client box (staff only — never the client panel). */
function SetupTimer({ startedAt, finishedAt }: { startedAt?: string | null; finishedAt?: string | null }) {
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const [now, setNow] = useState(() => (start ?? Date.now()));
  useEffect(() => {
    setNow(Date.now());
    if (finishedAt || start == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finishedAt, start]);
  if (start == null) return null;
  if (finishedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700" title={`Started ${new Date(startedAt!).toLocaleString()} · finished ${new Date(finishedAt).toLocaleString()}`}>
        ✅ Finished in {fmtDuration(new Date(finishedAt).getTime() - start)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 tabular-nums" title={`Setup running since ${new Date(startedAt!).toLocaleString()}`}>
      ⏱ {fmtDuration(now - start)}
    </span>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const color = percent >= 100 ? 'bg-emerald-500' : percent > 0 ? 'bg-brand-500' : 'bg-slate-300';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export default function ReportingPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN';

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [team, setTeam] = useState<Member[]>([]);
  const [openClient, setOpenClient] = useState<{ id: string; name: string } | null>(null);
  const [manageTpl, setManageTpl] = useState(false);
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);

  useEffect(() => { api.get<{ remindersEnabled: boolean }>('/reporting/settings').then((r) => setRemindersOn(r.remindersEnabled)).catch(() => {}); }, []);
  async function toggleReminders() {
    const next = !remindersOn;
    setRemindersOn(next);
    try { await api.patch('/reporting/settings', { remindersEnabled: next }); }
    catch { setRemindersOn(!next); }
  }

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (dq) params.set('search', dq);
    api.get<ClientRow[]>(`/reporting/clients?${params}`).then(setClients).catch(() => {}).finally(() => setLoaded(true));
  }, [dq]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Member[]>('/reporting/team').then(setTeam).catch(() => {}); }, []);

  return (
    <div>
      <PageHeader
        title="Reporting"
        subtitle="Onboarding & setup progress for every client workspace — who owns each step and where it stands."
        action={canManage ? <button className="btn-ghost" onClick={() => setManageTpl(true)}>⚙ Manage default steps</button> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input className="input max-w-xs" placeholder="Search client, invoice, product…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex items-center gap-4">
          {remindersOn !== null && (
            <label className={`flex items-center gap-2 text-sm ${canManage ? 'cursor-pointer' : 'cursor-default'} text-slate-600`} title="Daily email + WhatsApp nudges to each step's owner until it's finished">
              <span>Daily reminders</span>
              <button
                type="button"
                disabled={!canManage}
                onClick={canManage ? toggleReminders : undefined}
                className={`relative h-5 w-9 rounded-full transition ${remindersOn ? 'bg-emerald-500' : 'bg-slate-300'} ${canManage ? '' : 'opacity-70'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${remindersOn ? 'left-[1.15rem]' : 'left-0.5'}`} />
              </button>
            </label>
          )}
          <SetupMonthLegend />
        </div>
      </div>

      {!loaded ? (
        <EmptyState message="Loading…" />
      ) : clients.length === 0 ? (
        <EmptyState message="No client workspaces found." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {clients.map((c) => (
            <button key={c.id} onClick={() => setOpenClient({ id: c.id, name: c.name })} className="card p-5 text-left transition hover:border-brand-300 hover:shadow-sm">
              <div className="mb-2 flex justify-end text-[11px]">
                <SetupTimer startedAt={c.setupStartedAt} finishedAt={c.setupFinishedAt} />
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{c.name}</span>
                    <CategoryBadge category={c.productCategory} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {c.plan}{c.invoiceNo ? ` · Invoice ${c.invoiceNo}` : ''}{c.invoiceDate ? ` · ${new Date(c.invoiceDate).toLocaleDateString()}` : ''}
                    {c.salesPerson ? ` · 🧑‍💼 ${c.salesPerson.name}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-lg font-bold text-slate-700">{c.progress.percent}%</span>
              </div>
              <div className="mt-3"><ProgressBar percent={c.progress.percent} /></div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{c.progress.finished} finished</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{c.progress.started} in progress</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{c.progress.total} steps</span>
                {c.emailEnabled && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">Email</span>}
                {c.linkedInEnabled && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">LinkedIn</span>}
              </div>
              <SetupMonthSquares months={c.months} className="mt-3" />
            </button>
          ))}
        </div>
      )}

      {openClient && (
        <ClientDetailModal
          clientId={openClient.id}
          clientName={openClient.name}
          team={team}
          canManage={!!canManage}
          onClose={() => setOpenClient(null)}
          onChanged={load}
        />
      )}
      {manageTpl && <ManageTemplateModal onClose={() => setManageTpl(false)} />}
    </div>
  );
}

// ── One client's checklist ─────────────────────────────────────────────
function ClientDetailModal({
  clientId, clientName, team, canManage, onClose, onChanged,
}: {
  clientId: string; clientName: string; team: Member[]; canManage: boolean; onClose: () => void; onChanged: () => void;
}) {
  const canDelete = useCanDelete();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState<Group>('GENERAL');

  const load = useCallback(() => {
    api.get<Detail>(`/reporting/clients/${clientId}`).then(setDetail).catch(() => {});
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function patch(stepId: string, body: { status?: Status; assigneeUserId?: string; label?: string; hidden?: boolean }) {
    setBusy(true);
    try { await api.patch(`/reporting/steps/${stepId}`, body); load(); onChanged(); }
    catch (e: any) { alert(e?.message ?? 'Update failed'); }
    finally { setBusy(false); }
  }
  async function addStep() {
    if (!newLabel.trim()) return;
    setBusy(true);
    try { await api.post(`/reporting/clients/${clientId}/steps`, { label: newLabel.trim(), group: newGroup }); setNewLabel(''); load(); onChanged(); }
    catch (e: any) { alert(e?.message ?? 'Could not add'); }
    finally { setBusy(false); }
  }
  async function removeStep(stepId: string) {
    if (!confirm('Remove this custom step?')) return;
    setBusy(true);
    try { await api.del(`/reporting/steps/${stepId}`); load(); onChanged(); }
    catch (e: any) { alert(e?.message ?? 'Could not remove'); }
    finally { setBusy(false); }
  }
  async function setMonths(months: number) {
    setBusy(true);
    try { await api.patch(`/reporting/clients/${clientId}/months`, { months }); load(); onChanged(); }
    catch (e: any) { alert(e?.message ?? 'Could not update'); }
    finally { setBusy(false); }
  }
  async function notifyTeam() {
    if (!confirm('Email + WhatsApp each assigned person about their pending setup tasks for this client?')) return;
    setBusy(true);
    try { const r = await api.post<{ notified: number }>(`/reporting/clients/${clientId}/notify`, {}); load(); alert(`Notified ${r.notified} assignee(s).`); }
    catch (e: any) { alert(e?.message ?? 'Could not notify'); }
    finally { setBusy(false); }
  }

  const grouped = useMemo(() => {
    const g = emptyGroups<Step>();
    (detail?.steps ?? []).forEach((s) => g[s.group].push(s));
    return g;
  }, [detail]);

  return (
    <Modal open onClose={onClose} title={`Setup — ${clientName}`} wide>
      {!detail ? (
        <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1"><ProgressBar percent={detail.progress.percent} /></div>
            <span className="text-sm font-semibold text-slate-700">{detail.progress.percent}%</span>
            <span className="text-xs text-slate-400">{detail.progress.finished}/{detail.progress.total} finished</span>
          </div>

          {canManage && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span>Months of service:</span>
                <select
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                  value={detail.client.serviceMonths}
                  disabled={busy}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  title="Generates a monthly Email-arrangement step for each month"
                >
                  <option value={0}>— none —</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>)}
                </select>
                <span className="text-xs text-slate-400">(monthly steps are internal — not shown to the client)</span>
              </label>
              <button className="btn-ghost text-sm" onClick={notifyTeam} disabled={busy} title="Email + WhatsApp each assigned person their pending tasks">
                {detail.client.setupNotifiedAt ? '🔔 Re-notify team' : '🔔 Notify assigned team'}
              </button>
            </div>
          )}

          {GROUP_ORDER.map((grp) => grouped[grp].length > 0 && (
            <div key={grp} className="mb-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{GROUP_LABEL[grp]}</div>
              <div className="space-y-2">
                {grouped[grp].map((s) => (
                  <StepRow key={s.id} step={s} team={team} canManage={canManage} canDelete={canDelete} busy={busy} onPatch={patch} onRemove={removeStep} />
                ))}
              </div>
            </div>
          ))}

          {canManage && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-3">
              <div className="mb-2 text-xs font-medium text-slate-500">Add a custom step for this client</div>
              <div className="flex flex-wrap items-center gap-2">
                <input className="input flex-1" placeholder="Step name…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
                <select className="input w-40" value={newGroup} onChange={(e) => setNewGroup(e.target.value as Group)}>
                  {ADDABLE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                </select>
                <button className="btn-primary" onClick={addStep} disabled={busy || !newLabel.trim()}>Add</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function StepRow({
  step, team, canManage, canDelete, busy, onPatch, onRemove,
}: {
  step: Step; team: Member[]; canManage: boolean; canDelete: boolean; busy: boolean;
  onPatch: (id: string, b: { status?: Status; assigneeUserId?: string; label?: string; hidden?: boolean }) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(step.label);
  const last = step.updatedByName
    ? `${step.updatedByName} · ${new Date(step.updatedAt).toLocaleString()}`
    : null;
  const saveRename = () => {
    setEditing(false);
    if (editLabel.trim() && editLabel.trim() !== step.label) onPatch(step.id, { label: editLabel.trim() });
  };
  return (
    <div className={`rounded-xl border border-slate-100 p-3 ${step.hidden ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {step.hidden && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">hidden</span>}
          {editing ? (
            <input
              autoFocus className="input flex-1 py-1 text-sm" value={editLabel} disabled={busy}
              onChange={(e) => setEditLabel(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditLabel(step.label); setEditing(false); } }}
            />
          ) : (
            <>
              <span className="font-medium text-slate-800">{step.label}</span>
              {!step.templateKey && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">custom</span>}
              {canManage && <button className="text-[11px] text-slate-400 hover:text-brand-600 hover:underline" onClick={() => { setEditLabel(step.label); setEditing(true); }}>Edit</button>}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(['NOT_STARTED', 'STARTED', 'FINISHED'] as Status[]).map((st) => (
            <button
              key={st}
              disabled={busy || st === step.status}
              onClick={() => onPatch(step.id, { status: st })}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${st === step.status ? STATUS[st].cls : 'text-slate-400 hover:bg-slate-100'}`}
              title={`Mark ${STATUS[st].label}`}
            >
              {STATUS[st].label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-400">Owner:</span>
          {canManage ? (
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              value={step.assigneeUserId ?? ''}
              disabled={busy}
              onChange={(e) => onPatch(step.id, { assigneeUserId: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name} ({roleLabel(m.role)})</option>)}
            </select>
          ) : (
            <span className="font-medium text-slate-600">{step.assigneeName ?? '—'}</span>
          )}
        </label>
        {step.startedAt && <span title="Started">▶ {new Date(step.startedAt).toLocaleDateString()}</span>}
        {step.finishedAt && <span className="text-emerald-600" title="Finished">✓ {new Date(step.finishedAt).toLocaleDateString()}</span>}
        {last && <span className="text-slate-400">· last: {last}</span>}
        {canManage && step.templateKey && (
          <button className="ml-auto text-slate-400 hover:text-slate-700" onClick={() => onPatch(step.id, { hidden: !step.hidden })} title={step.hidden ? 'Show this step for this client' : 'Hide this step for this client only'}>
            {step.hidden ? 'Unhide' : 'Hide'}
          </button>
        )}
        {canDelete && !step.templateKey && (
          <button className="ml-auto text-rose-400 hover:text-rose-600" onClick={() => onRemove(step.id)} title="Delete custom step">Delete</button>
        )}
      </div>
    </div>
  );
}

// ── Manage the default checklist (admins) ──────────────────────────────
function ManageTemplateModal({ onClose }: { onClose: () => void }) {
  const canDelete = useCanDelete();
  const [rows, setRows] = useState<TemplateStep[]>([]);
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState<Group>('GENERAL');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const load = useCallback(() => { api.get<TemplateStep[]>('/reporting/template').then(setRows).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function rename(r: TemplateStep) {
    if (!editLabel.trim() || editLabel.trim() === r.label) { setEditId(null); return; }
    setBusy(true);
    try { await api.patch(`/reporting/template/${r.id}`, { label: editLabel.trim() }); setEditId(null); load(); }
    catch (e: any) { alert(e?.message ?? 'Rename failed'); }
    finally { setBusy(false); }
  }
  async function del(r: TemplateStep) {
    if (!confirm(`Delete "${r.label}" from the default list? This removes it from every client. This cannot be undone.`)) return;
    setBusy(true);
    try { await api.del(`/reporting/template/${r.id}`); load(); }
    catch (e: any) { alert(e?.message ?? 'Delete failed'); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!label.trim()) return;
    setBusy(true);
    try { await api.post('/reporting/template', { label: label.trim(), group }); setLabel(''); load(); }
    catch (e: any) { alert(e?.message ?? 'Could not add'); }
    finally { setBusy(false); }
  }
  async function toggle(r: TemplateStep) {
    setBusy(true);
    try { await api.patch(`/reporting/template/${r.id}`, { active: !r.active }); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }
  async function move(r: TemplateStep, dir: 'up' | 'down') {
    setBusy(true);
    try { await api.patch(`/reporting/template/${r.id}/move`, { dir }); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  const grouped = useMemo(() => {
    const g = emptyGroups<TemplateStep>();
    rows.forEach((r) => g[r.group].push(r));
    return g;
  }, [rows]);

  return (
    <Modal open onClose={onClose} title="Default setup steps" wide>
      <p className="mb-3 text-xs text-slate-500">These apply to every client (Email steps only for Email-enabled clients, LinkedIn steps only for LinkedIn-enabled clients). Deactivating a step stops it seeding new clients but keeps existing history.</p>
      {GROUP_ORDER.map((grp) => grouped[grp].length > 0 && (
        <div key={grp} className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{GROUP_LABEL[grp]}</div>
          <div className="space-y-1.5">
            {grouped[grp].map((r, i) => (
              <div key={r.id} className={`flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm ${r.active ? '' : 'opacity-50'}`}>
                {editId === r.id ? (
                  <input
                    autoFocus className="input flex-1 py-1 text-sm" value={editLabel} disabled={busy}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') rename(r); if (e.key === 'Escape') setEditId(null); }}
                    onBlur={() => rename(r)}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-slate-700">{r.label}</span>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <button className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(r, 'up')} title="Move up">▲</button>
                  <button className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30" disabled={busy || i === grouped[grp].length - 1} onClick={() => move(r, 'down')} title="Move down">▼</button>
                  <button className="ml-1 text-xs text-slate-500 hover:underline" disabled={busy} onClick={() => { setEditId(r.id); setEditLabel(r.label); }}>Edit</button>
                  <button className="text-xs text-slate-500 hover:underline" disabled={busy} onClick={() => toggle(r)}>
                    {r.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  {canDelete && <button className="text-xs text-rose-500 hover:underline" disabled={busy} onClick={() => del(r)}>Delete</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-3">
        <div className="mb-2 text-xs font-medium text-slate-500">Add a new default step</div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1" placeholder="Step name…" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select className="input w-40" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            {ADDABLE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
          <button className="btn-primary" onClick={add} disabled={busy || !label.trim()}>Add</button>
        </div>
      </div>
    </Modal>
  );
}
