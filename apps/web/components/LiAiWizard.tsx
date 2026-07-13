'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LiTagInput } from '@/components/LiTagInput';
import { LiKnowledgeModal } from '@/components/LiKnowledgeModal';
import { LinkedInAccount, LiKnowledgeSummary } from '@/lib/linkedin';

const STEPS = ['Connect', 'Business', 'Strategy', 'Audience', 'Messages', 'Schedule', 'Review'];
const COMPANY_SIZES = ['Startup (1-10)', 'Small (11-50)', 'Medium (51-200)', 'Large (201-1000)', 'Enterprise (1000+)'];
const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const;

type Audience = Record<string, string[]>;
const emptyAudience: Audience = {
  countries: [], cities: [], industries: [], companySizes: [], departments: [], jobTitles: [], seniorities: [],
  companyKeywordsInclude: [], companyKeywordsExclude: [], personKeywordsInclude: [], personKeywordsExclude: [],
};

export function LiAiWizard({ clientId, base = '/linkedin', launchMode = 'resume', onDone }: { clientId: string; base?: string; launchMode?: 'resume' | 'submit'; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [gen, setGen] = useState(false);
  const [error, setError] = useState('');

  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [businesses, setBusinesses] = useState<LiKnowledgeSummary[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [strategies, setStrategies] = useState<LiKnowledgeSummary[]>([]);
  const [strategyId, setStrategyId] = useState('');
  const [modal, setModal] = useState<{ id: string; title: string } | null>(null);

  const [name, setName] = useState('');
  const [outreachType, setOutreachType] = useState<'WITH_CONNECTION' | 'DIRECT_MESSAGES'>('WITH_CONNECTION');
  const [audience, setAudience] = useState<Audience>(emptyAudience);
  const [note, setNote] = useState('');
  const [noteVariants, setNoteVariants] = useState<string[]>([]);
  const [aiVariants, setAiVariants] = useState(1); // wordings per step for AI generation
  const [followUps, setFollowUps] = useState<{ waitHours: number; body: string; variants: string[] }[]>([{ waitHours: 24, body: '', variants: [] }]);
  const [sched, setSched] = useState({ timezone: 'Asia/Kolkata', run247: false, workStartHour: 9, workEndHour: 18, workDays: [1, 2, 3, 4, 5] as number[], dailyConnectionLimit: 20, dailyMessageLimit: 20 });
  const [campaignId, setCampaignId] = useState<string | null>(null);

  useEffect(() => { api.get<LinkedInAccount[]>(`${base}/clients/${clientId}/linkedin-accounts`).then((a) => setAccounts(a.filter((x) => x.status === 'CONNECTED'))); }, [clientId]);
  const loadBusinesses = () => api.get<LiKnowledgeSummary[]>(`${base}/clients/${clientId}/business-profiles`).then(setBusinesses);
  const loadStrategies = (bid: string) => api.get<LiKnowledgeSummary[]>(`${base}/business-profiles/${bid}/strategies`).then(setStrategies);
  useEffect(() => { if (step === 1) loadBusinesses(); }, [step]); // eslint-disable-line
  useEffect(() => { if (step === 2 && businessId) loadStrategies(businessId); }, [step, businessId]); // eslint-disable-line

  const setAud = (k: string, v: string[]) => setAudience((a) => ({ ...a, [k]: v }));

  async function ensureCampaign() {
    if (campaignId) { await api.patch(`${base}/campaigns/${campaignId}`, { name, outreachType }); return campaignId; }
    const c = await api.post<{ id: string }>(`${base}/campaigns`, { clientId, linkedInAccountId: accountId, name, mode: 'AI', outreachType, businessProfileId: businessId, strategyId });
    setCampaignId(c.id); return c.id;
  }
  const cleanVariants = (v: string[]) => v.map((x) => (x ?? '').trim()).filter(Boolean).slice(0, 2);
  function buildSteps() {
    const steps: any[] = [];
    if (outreachType === 'WITH_CONNECTION') steps.push({ type: 'CONNECTION_REQUEST', waitHours: 0, note: note || undefined, variants: cleanVariants(noteVariants) });
    followUps.forEach((f, i) => steps.push({ type: 'MESSAGE', waitHours: outreachType === 'DIRECT_MESSAGES' && i === 0 ? 0 : Number(f.waitHours), body: f.body, variants: cleanVariants(f.variants) }));
    return steps;
  }

  async function createProfile(kind: 'business' | 'strategy') {
    const nm = prompt(kind === 'business' ? 'Business / company name:' : 'Campaign strategy name:');
    if (!nm) return;
    if (kind === 'business') { const p = await api.post<{ id: string; name: string }>(`${base}/clients/${clientId}/business-profiles`, { name: nm }); await loadBusinesses(); setBusinessId(p.id); setModal({ id: p.id, title: p.name }); }
    else { const p = await api.post<{ id: string; name: string }>(`${base}/business-profiles/${businessId}/strategies`, { name: nm }); await loadStrategies(businessId); setStrategyId(p.id); setModal({ id: p.id, title: p.name }); }
  }

  async function generateAudience() {
    setGen(true); setError('');
    try {
      const cid = await ensureCampaign();
      const spec = await api.post<Audience>(`${base}/campaigns/${cid}/generate-audience`);
      setAudience({ ...emptyAudience, ...Object.fromEntries(Object.keys(emptyAudience).map((k) => [k, (spec as any)[k] ?? []])) });
    } catch (e: any) { setError(e.message ?? 'Generation failed'); } finally { setGen(false); }
  }
  async function generateMessages() {
    setGen(true); setError('');
    try {
      const cid = await ensureCampaign();
      const camp = await api.post<{ steps: { type: string; waitHours: number; body?: string; note?: string; variants?: string[] }[] }>(`${base}/campaigns/${cid}/generate-messages`, { outreachType, followUps: Math.max(1, followUps.length), variants: aiVariants });
      const conn = camp.steps.find((s) => s.type === 'CONNECTION_REQUEST');
      const msgs = camp.steps.filter((s) => s.type === 'MESSAGE');
      setNote(conn?.note ?? '');
      setNoteVariants(cleanVariants(conn?.variants ?? []));
      setFollowUps(msgs.length ? msgs.map((m) => ({ waitHours: m.waitHours, body: m.body ?? '', variants: cleanVariants(m.variants ?? []) })) : [{ waitHours: 24, body: '', variants: [] }]);
    } catch (e: any) { setError(e.message ?? 'Generation failed'); } finally { setGen(false); }
  }

  async function next() {
    setError(''); setSaving(true);
    try {
      if (step === 0 && !accountId) throw new Error('Select an account');
      if (step === 1 && !businessId) throw new Error('Select or create a business profile');
      if (step === 2 && !strategyId) throw new Error('Select or create a strategy');
      if (step === 3) { if (!name.trim()) throw new Error('Campaign name is required'); const cid = await ensureCampaign(); await api.patch(`${base}/campaigns/${cid}/audience`, audience); }
      if (step === 4) { if (followUps.some((f) => !f.body.trim())) throw new Error('Each message needs content'); const cid = await ensureCampaign(); await api.patch(`${base}/campaigns/${cid}/sequence`, { steps: buildSteps() }); }
      if (step === 5) { const cid = await ensureCampaign(); await api.patch(`${base}/campaigns/${cid}/schedule`, sched); }
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } catch (e: any) { setError(e.message ?? 'Something went wrong'); } finally { setSaving(false); }
  }
  async function launch() {
    setSaving(true); setError('');
    try {
      const cid = await ensureCampaign();
      await api.post(`${base}/campaigns/${cid}/${launchMode === 'submit' ? 'submit' : 'resume'}`);
      onDone();
    } catch (e: any) { setError(e.message ?? 'Launch failed'); setSaving(false); }
  }

  return (
    <div>
      {/* Stepper */}
      <div className="mb-6 flex items-center justify-between">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < step ? '✓' : i + 1}</div>
              <div className={`mt-1 text-[11px] ${i === step ? 'font-semibold text-slate-700' : 'text-slate-400'}`}>{label}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`mx-1 h-0.5 flex-1 ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="card space-y-4 p-6">
        {step === 0 && (
          <Sec title="Select the LinkedIn account">
            {accounts.length === 0 ? <div className="text-slate-400">No connected accounts. Connect one on the Accounts tab first.</div> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {accounts.map((a) => <button key={a.id} onClick={() => setAccountId(a.id)} className={`rounded-xl border p-4 text-left ${accountId === a.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}><div className="font-medium text-slate-800">{a.fullName}</div><div className="line-clamp-1 text-sm text-slate-500">{a.headline}</div></button>)}
              </div>
            )}
          </Sec>
        )}

        {step === 1 && (
          <Sec title="Business Profile" desc="AI uses this 'business DNA' to generate your campaign.">
            <ProfileGrid items={businesses} selectedId={businessId} onSelect={setBusinessId} onSetup={(id, title) => setModal({ id, title })} onCreate={() => createProfile('business')} />
          </Sec>
        )}

        {step === 2 && (
          <Sec title="Campaign Strategy" desc="Goals, offer, and ideal-person for this campaign.">
            <ProfileGrid items={strategies} selectedId={strategyId} onSelect={setStrategyId} onSetup={(id, title) => setModal({ id, title })} onCreate={() => createProfile('strategy')} />
          </Sec>
        )}

        {step === 3 && (
          <Sec title="Target Audience" desc="Generate from your profiles, or edit manually.">
            <GenBanner label="Generate Audience" hint="AI suggests countries, industries, job titles, and more from your Business + Strategy." busy={gen} onGen={generateAudience} />
            <Field label="Campaign Name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My First Campaign" /></Field>
            <AudField label="Countries" v={audience.countries} on={(v) => setAud('countries', v)} />
            <AudField label="Industries" v={audience.industries} on={(v) => setAud('industries', v)} />
            <Field label="Company Size"><div className="flex flex-wrap gap-2">{COMPANY_SIZES.map((s) => { const on = audience.companySizes.includes(s); return <button key={s} onClick={() => setAud('companySizes', on ? audience.companySizes.filter((x) => x !== s) : [...audience.companySizes, s])} className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600'}`}>{s}</button>; })}</div></Field>
            <AudField label="Departments" v={audience.departments} on={(v) => setAud('departments', v)} />
            <AudField label="Job Titles" v={audience.jobTitles} on={(v) => setAud('jobTitles', v)} />
          </Sec>
        )}

        {step === 4 && (
          <Sec title="Messaging" desc="Generate personalized messages, or write your own.">
            <Field label="Type"><div className="flex gap-2">{(['WITH_CONNECTION', 'DIRECT_MESSAGES'] as const).map((t) => <button key={t} onClick={() => setOutreachType(t)} className={`rounded-lg border px-3 py-1.5 text-sm ${outreachType === t ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>{t === 'WITH_CONNECTION' ? 'With Connection' : 'Direct Messages'}</button>)}</div></Field>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Wordings per step (human-likeness)</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" onClick={() => setAiVariants(n)} className={`rounded-md px-3 py-1 font-medium ${aiVariants === n ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>{n}</button>
                ))}
              </div>
            </div>
            <GenBanner label="Generate Messages" hint={`AI writes a connection note + follow-ups (${aiVariants} wording${aiVariants > 1 ? 's each — picked at random per lead' : ''}) from your Business + Strategy.`} busy={gen} onGen={generateMessages} />
            {outreachType === 'WITH_CONNECTION' && (
              <div className="rounded-xl border border-brand-200 p-4"><div className="font-medium text-slate-800">Connection Request</div><textarea className="input mt-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" /><VariantsEditor variants={noteVariants} onChange={setNoteVariants} rows={2} /></div>
            )}
            {followUps.map((f, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium text-slate-800">{outreachType === 'DIRECT_MESSAGES' && i === 0 ? 'First Message' : `Follow-up ${i + 1}`}</div>
                  <div className="flex items-center gap-3 text-sm">
                    {!(outreachType === 'DIRECT_MESSAGES' && i === 0) && <span>Wait <input type="number" min={0} className="w-16 rounded border border-slate-300 px-2 py-0.5" value={f.waitHours} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, waitHours: Number(e.target.value) } : x))} /> h</span>}
                    {followUps.length > 1 && <button className="text-rose-500" onClick={() => setFollowUps((fs) => fs.filter((_, j) => j !== i))}>Delete</button>}
                  </div>
                </div>
                <textarea className="input" rows={3} value={f.body} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} />
                <div className="mt-1 text-xs text-slate-400">Tokens: {'{first_name} {company} {title}'}</div>
                <VariantsEditor variants={f.variants} onChange={(v) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, variants: v } : x))} />
              </div>
            ))}
            <button className="btn-ghost w-full" onClick={() => setFollowUps((fs) => [...fs, { waitHours: 48, body: '', variants: [] }])}>+ Add message</button>
          </Sec>
        )}

        {step === 5 && (
          <Sec title="Schedule & Limits">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone"><select className="input" value={sched.timezone} onChange={(e) => setSched({ ...sched, timezone: e.target.value })}>{['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore'].map((t) => <option key={t}>{t}</option>)}</select></Field>
              <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" checked={sched.run247} onChange={(e) => setSched({ ...sched, run247: e.target.checked })} /> Run 24/7</label>
            </div>
            {!sched.run247 && <div className="grid gap-4 sm:grid-cols-2"><Field label="Start hour"><input type="number" min={0} max={23} className="input" value={sched.workStartHour} onChange={(e) => setSched({ ...sched, workStartHour: Number(e.target.value) })} /></Field><Field label="End hour"><input type="number" min={0} max={23} className="input" value={sched.workEndHour} onChange={(e) => setSched({ ...sched, workEndHour: Number(e.target.value) })} /></Field></div>}
            <Field label="Working Days"><div className="flex flex-wrap gap-2">{DAYS.map(([lbl, d]) => { const on = sched.workDays.includes(d); return <button key={d} onClick={() => setSched({ ...sched, workDays: on ? sched.workDays.filter((x) => x !== d) : [...sched.workDays, d] })} className={`rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{lbl}</button>; })}</div></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Daily connections"><input type="number" min={1} className="input" value={sched.dailyConnectionLimit} onChange={(e) => setSched({ ...sched, dailyConnectionLimit: Number(e.target.value) })} /></Field><Field label="Daily messages"><input type="number" min={1} className="input" value={sched.dailyMessageLimit} onChange={(e) => setSched({ ...sched, dailyMessageLimit: Number(e.target.value) })} /></Field></div>
          </Sec>
        )}

        {step === 6 && (
          <Sec title="Review & Launch">
            <Row k="Campaign" v={name} /><Row k="Mode" v="AI" />
            <Row k="Account" v={accounts.find((a) => a.id === accountId)?.fullName ?? '—'} />
            <Row k="Business" v={businesses.find((b) => b.id === businessId)?.name ?? '—'} />
            <Row k="Strategy" v={strategies.find((s) => s.id === strategyId)?.name ?? '—'} />
            <Row k="Countries" v={audience.countries.join(', ') || '—'} />
            <Row k="Sequence" v={`${buildSteps().length} steps`} />
            <Row k="Schedule" v={sched.run247 ? '24/7' : `${sched.workStartHour}:00–${sched.workEndHour}:00, ${sched.workDays.length} days`} />
          </Sec>
        )}
      </div>

      <div className="mt-4 flex justify-between">
        <button className="btn-ghost" disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>← Back</button>
        {step < STEPS.length - 1
          ? <button className="btn-primary" disabled={saving} onClick={next}>{saving ? 'Saving…' : 'Next Step →'}</button>
          : <button className="btn-primary" disabled={saving} onClick={launch}>{saving ? 'Submitting…' : launchMode === 'submit' ? '✓ Submit for Approval' : '✓ Launch Campaign'}</button>}
      </div>

      {modal && <LiKnowledgeModal profileId={modal.id} title={modal.title} base={base} onClose={() => { setModal(null); if (step === 1) loadBusinesses(); if (step === 2 && businessId) loadStrategies(businessId); }} />}
    </div>
  );
}

/** Up to 2 alternate wordings for a step; a lead gets one at random from primary + these. */
function VariantsEditor({ variants, onChange, rows = 3 }: { variants: string[]; onChange: (v: string[]) => void; rows?: number }) {
  return (
    <div className="mt-2 space-y-2">
      {variants.map((v, i) => (
        <div key={i} className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-2">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Variant {String.fromCharCode(66 + i)} · picked at random per lead</span>
            <button type="button" className="text-rose-500" onClick={() => onChange(variants.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <textarea className="input" rows={rows} value={v} onChange={(e) => onChange(variants.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Alternate wording — same meaning, different words" />
        </div>
      ))}
      {variants.length < 2 && (
        <button type="button" className="text-sm text-brand-600 hover:text-brand-700" onClick={() => onChange([...variants, ''])}>
          + Add wording variant (up to 2 · more human)
        </button>
      )}
    </div>
  );
}

function ProfileGrid({ items, selectedId, onSelect, onSetup, onCreate }: { items: LiKnowledgeSummary[]; selectedId: string; onSelect: (id: string) => void; onSetup: (id: string, title: string) => void; onCreate: () => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((p) => (
        <div key={p.id} className={`rounded-xl border p-4 ${selectedId === p.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between">
            <button onClick={() => onSelect(p.id)} className="font-medium text-slate-800">{p.name}</button>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.completeness >= 100 ? 'bg-emerald-100 text-emerald-700' : p.completeness > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{p.completeness}%</span>
          </div>
          <div className="mt-2 flex gap-3 text-sm">
            <button onClick={() => onSelect(p.id)} className="text-brand-700">{selectedId === p.id ? 'Selected' : 'Select'}</button>
            <button onClick={() => onSetup(p.id, p.name)} className="text-slate-500 hover:text-slate-800">Setup / Edit →</button>
          </div>
        </div>
      ))}
      <button onClick={onCreate} className="grid place-items-center rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 hover:border-brand-300 hover:text-brand-700">+ Create New</button>
    </div>
  );
}
function GenBanner({ label, hint, busy, onGen }: { label: string; hint: string; busy: boolean; onGen: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/60 p-4">
      <div className="pr-4 text-sm text-slate-600">{hint}</div>
      <button className="btn-primary shrink-0" disabled={busy} onClick={onGen}>{busy ? 'Generating…' : `✦ ${label}`}</button>
    </div>
  );
}
function Sec({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return <div className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-800">{title}</h2>{desc && <p className="text-sm text-slate-500">{desc}</p>}</div>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium text-slate-600">{label}</label>{children}</div>;
}
function AudField({ label, v, on }: { label: string; v: string[]; on: (v: string[]) => void }) {
  return <Field label={label}><LiTagInput value={v} onChange={on} placeholder={`Add ${label.toLowerCase()}…`} /></Field>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{k}</span><span className="max-w-[60%] text-right font-medium text-slate-800">{v}</span></div>;
}
