'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { LiTagInput } from '@/components/LiTagInput';
import { LinkedInAccount, LiCampaignDetail, LiSubscription } from '@/lib/linkedin';

const STEPS = ['Connect', 'Audience', 'Messages', 'Schedule', 'Review'];
const COMPANY_SIZES = ['Startup (1-10)', 'Small (11-50)', 'Medium (51-200)', 'Large (201-1000)', 'Enterprise (1000+)'];
const COUNTRY_SUGGEST = ['India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'UAE', 'Singapore'];
const INDUSTRY_SUGGEST = ['Information Technology', 'Financial Services', 'Healthcare', 'Manufacturing', 'Retail & E-commerce', 'Consulting', 'Marketing & Advertising'];
const DEPT_SUGGEST = ['Sales', 'Marketing', 'Human Resources', 'Finance', 'Engineering', 'Operations', 'Product', 'Business Development', 'Executive/C-Suite'];
const TITLE_SUGGEST = ['CEO', 'CTO', 'CFO', 'VP of Sales', 'Marketing Manager', 'Product Manager', 'Sales Manager', 'Founder'];
const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const;

type Audience = Record<string, string[]>;
const emptyAudience: Audience = {
  countries: [], cities: [], industries: [], companySizes: [], departments: [], jobTitles: [], seniorities: [],
  companyKeywordsInclude: [], companyKeywordsExclude: [], personKeywordsInclude: [], personKeywordsExclude: [],
};

/**
 * Reusable Regular-mode campaign wizard. Admin passes launchMode="resume" (launch
 * immediately); the client portal passes launchMode="submit" (submit for approval).
 */
export function LiRegularWizard({
  clientId,
  base = '/linkedin',
  launchMode = 'resume',
  editCampaignId,
  onBack,
  onDone,
}: {
  clientId: string;
  base?: string;
  launchMode?: 'resume' | 'submit';
  editCampaignId?: string;
  onBack?: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sourcing, setSourcing] = useState(false);
  const [sourceMsg, setSourceMsg] = useState('');
  // Audience sourcing (manual + drip) is admin-only — hidden in the client portal.
  const isPortal = base.includes('/portal');

  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [outreachType, setOutreachType] = useState<'WITH_CONNECTION' | 'DIRECT_MESSAGES'>('WITH_CONNECTION');
  const [audience, setAudience] = useState<Audience>(emptyAudience);
  const [note, setNote] = useState('');
  const [followUps, setFollowUps] = useState([{ waitHours: 24, body: 'Hi {first_name}, thanks for connecting. Would love to share how we help teams like {company}.' }]);
  const [sched, setSched] = useState({
    timezone: 'Asia/Kolkata', run247: false, workStartHour: 9, workEndHour: 18,
    workDays: [1, 2, 3, 4, 5] as number[], dailyConnectionLimit: 20, dailyMessageLimit: 20,
    warmupEnabled: true, warmupStartLimit: 5, warmupDays: 14,
    dripEnabled: false, dripDailyTarget: 25, dripBuffer: 50,
  });

  useEffect(() => {
    api.get<LinkedInAccount[]>(`${base}/clients/${clientId}/linkedin-accounts`)
      .then((a) => setAccounts(a.filter((x) => x.status === 'CONNECTED' && !x.deactivated)));
  }, [clientId, base]);

  // New campaign: prefill the schedule from the client's LinkedIn sending defaults
  // (set by the admin at registration). Edit mode loads the campaign's own values.
  useEffect(() => {
    if (editCampaignId) return;
    api.get<LiSubscription>(`${base}/clients/${clientId}/subscription`).then((s) => {
      const d = s.campaignDefaults ?? {};
      setSched((prev) => ({
        ...prev,
        timezone: s.timezone ?? prev.timezone,
        run247: d.run247 ?? prev.run247,
        workStartHour: d.workStartHour ?? prev.workStartHour,
        workEndHour: d.workEndHour ?? prev.workEndHour,
        workDays: d.workDays ?? prev.workDays,
        dailyConnectionLimit: d.dailyConnectionLimit ?? prev.dailyConnectionLimit,
        dailyMessageLimit: d.dailyMessageLimit ?? prev.dailyMessageLimit,
        warmupEnabled: d.warmupEnabled ?? prev.warmupEnabled,
        warmupStartLimit: d.warmupStartLimit ?? prev.warmupStartLimit,
        warmupDays: d.warmupDays ?? prev.warmupDays,
        dripEnabled: d.dripEnabled ?? prev.dripEnabled,
        dripDailyTarget: d.dripDailyTarget ?? prev.dripDailyTarget,
        dripBuffer: d.dripBuffer ?? prev.dripBuffer,
      }));
    }).catch(() => {});
  }, [clientId, base, editCampaignId]);

  // Edit mode: pre-fill every step from the existing (draft) campaign.
  useEffect(() => {
    if (!editCampaignId) return;
    api.get<LiCampaignDetail>(`${base}/campaigns/${editCampaignId}`).then((c) => {
      setCampaignId(c.id);
      setEditStatus(c.status);
      setName(c.name);
      setAccountId(c.linkedInAccountId ?? c.linkedInAccount?.id ?? '');
      setOutreachType(c.outreachType);
      if (c.audienceSpec) {
        // Copy only the audience array fields — the raw spec also has id/campaignId/
        // createdAt/updatedAt, which the audience DTO rejects (forbidNonWhitelisted).
        const spec = c.audienceSpec as Record<string, unknown>;
        const next: Audience = { ...emptyAudience };
        (Object.keys(emptyAudience) as (keyof Audience)[]).forEach((k) => {
          if (Array.isArray(spec[k])) next[k] = spec[k] as string[];
        });
        setAudience(next);
      }
      setNote(c.steps.find((s) => s.type === 'CONNECTION_REQUEST')?.note ?? '');
      const msgs = c.steps.filter((s) => s.type === 'MESSAGE').map((s) => ({ waitHours: s.waitHours, body: s.body ?? '' }));
      if (msgs.length) setFollowUps(msgs);
      setSched((prev) => ({
        ...prev,
        timezone: c.timezone ?? prev.timezone,
        run247: c.run247 ?? prev.run247,
        workStartHour: c.workStartHour ?? prev.workStartHour,
        workEndHour: c.workEndHour ?? prev.workEndHour,
        workDays: c.workDays ?? prev.workDays,
        dailyConnectionLimit: c.dailyConnectionLimit ?? prev.dailyConnectionLimit,
        dailyMessageLimit: c.dailyMessageLimit ?? prev.dailyMessageLimit,
        warmupEnabled: c.warmupEnabled ?? prev.warmupEnabled,
        warmupStartLimit: c.warmupStartLimit ?? prev.warmupStartLimit,
        warmupDays: c.warmupDays ?? prev.warmupDays,
        dripEnabled: c.dripEnabled ?? prev.dripEnabled,
        dripDailyTarget: c.dripDailyTarget ?? prev.dripDailyTarget,
        dripBuffer: c.dripBuffer ?? prev.dripBuffer,
      }));
    }).catch(() => {});
  }, [editCampaignId, base]);

  const setAud = (k: string, v: string[]) => setAudience((a) => ({ ...a, [k]: v }));

  async function ensureCampaign() {
    if (campaignId) { await api.patch(`${base}/campaigns/${campaignId}`, { name }); return campaignId; }
    const c = await api.post<{ id: string }>(`${base}/campaigns`, { clientId, linkedInAccountId: accountId, name, mode: 'REGULAR', outreachType });
    setCampaignId(c.id); return c.id;
  }

  function buildSteps() {
    const steps: any[] = [];
    if (outreachType === 'WITH_CONNECTION') steps.push({ type: 'CONNECTION_REQUEST', waitHours: 0, note: note || undefined });
    followUps.forEach((f, i) => steps.push({ type: 'MESSAGE', waitHours: outreachType === 'DIRECT_MESSAGES' && i === 0 ? 0 : Number(f.waitHours), body: f.body }));
    return steps;
  }

  async function next() {
    setError(''); setSaving(true);
    try {
      if (step === 0) { if (!accountId) throw new Error('Select an account'); }
      else if (step === 1) {
        if (!name.trim()) throw new Error('Campaign name is required');
        const cid = await ensureCampaign();
        await api.patch(`${base}/campaigns/${cid}/audience`, audience);
      } else if (step === 2) {
        if (followUps.length === 0 || followUps.some((f) => !f.body.trim())) throw new Error('Each message needs content');
        const cid = await ensureCampaign();
        await api.patch(`${base}/campaigns/${cid}/sequence`, { steps: buildSteps() });
      } else if (step === 3) {
        const cid = await ensureCampaign();
        await api.patch(`${base}/campaigns/${cid}/schedule`, sched);
      }
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } catch (e: any) { setError(e.message ?? 'Something went wrong'); }
    finally { setSaving(false); }
  }

  async function launch() {
    setSaving(true); setError('');
    try {
      const cid = await ensureCampaign();
      await api.post(`${base}/campaigns/${cid}/${launchMode === 'submit' ? 'submit' : 'resume'}`);
      onDone();
    } catch (e: any) { setError(e.message ?? 'Launch failed'); setSaving(false); }
  }

  // A client editing a PAUSED (already-approved) campaign must re-submit for admin
  // approval before it can go live again — edits shouldn't reach prospects unreviewed.
  const needsReapproval = isPortal && !!editCampaignId && editStatus === 'PAUSED';

  // Edit mode: persist every step. For a client-edited paused campaign, also re-submit
  // for approval (backend demotes it to DRAFT so it can't be resumed directly).
  async function saveEdit() {
    setSaving(true); setError('');
    try {
      const cid = await ensureCampaign();
      await api.patch(`${base}/campaigns/${cid}/audience`, audience);
      await api.patch(`${base}/campaigns/${cid}/sequence`, { steps: buildSteps() });
      await api.patch(`${base}/campaigns/${cid}/schedule`, sched);
      if (needsReapproval) {
        await api.post(`${base}/campaigns/${cid}/submit`);
        alert('Changes saved and sent to your account team for approval — the campaign will resume once approved.');
      }
      onDone();
    } catch (e: any) { setError(e.message ?? 'Save failed'); setSaving(false); }
  }

  async function sourceNow() {
    setSourcing(true); setError(''); setSourceMsg('');
    try {
      const cid = await ensureCampaign();
      // Make sure the audience the user just defined is saved before searching.
      await api.patch(`${base}/campaigns/${cid}/audience`, audience);
      const r = await api.post<{ sourced: number; keywords: string; creditsCharged?: number }>(`${base}/campaigns/${cid}/source-leads?limit=25`, {});
      setSourceMsg(r.sourced > 0
        ? `✓ Added ${r.sourced} lead${r.sourced === 1 ? '' : 's'} to the Target Audience (query: “${r.keywords}”).${r.creditsCharged ? ' 1 credit used.' : ''} Pull more anytime on the campaign page.`
        : `No leads found for “${r.keywords}”. Broaden the audience above, or import leads manually on the campaign page.`);
    } catch (e: any) { setError(e.message ?? 'Sourcing failed'); }
    finally { setSourcing(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {onBack && <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-800">← Back</button>}
      <PageHeader
        title={editCampaignId ? 'Edit LinkedIn Campaign' : 'New LinkedIn Campaign'}
        subtitle={editCampaignId ? 'Update this draft’s audience, messages and schedule.' : 'Connect an account, define your audience and messages, then launch.'}
      />

      {/* Stepper */}
      <div className="mb-6 flex items-center justify-between">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <div className={`mt-1 text-xs ${i === step ? 'font-semibold text-slate-700' : 'text-slate-400'}`}>{label}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`mx-2 h-0.5 flex-1 ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="card p-6">
        {step === 0 && (
          <Step title="Select the LinkedIn account" desc="Which connected account should run this campaign?">
            {accounts.length === 0 ? (
              <div className="text-slate-400">No connected accounts. Connect one on the Accounts tab first.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {accounts.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAccountId(a.id)} className={`rounded-xl border p-4 text-left ${accountId === a.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
                    <div className="font-medium text-slate-800">{a.fullName}</div>
                    <div className="line-clamp-1 text-sm text-slate-500">{a.headline}</div>
                    {a.connectionsCount != null && <div className="mt-1 text-xs text-slate-400">{a.connectionsCount} connections</div>}
                  </button>
                ))}
              </div>
            )}
          </Step>
        )}

        {step === 1 && (
          <Step title="Target Audience" desc="Define who to reach with this campaign.">
            <Field label="Campaign Name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My First Campaign" /></Field>
            <AudField label="Countries *" sug={COUNTRY_SUGGEST} v={audience.countries} on={(v) => setAud('countries', v)} ph="Add a country…" />
            <AudField label="Cities" v={audience.cities} on={(v) => setAud('cities', v)} ph="Type a city and press Enter" />
            <AudField label="Industries" sug={INDUSTRY_SUGGEST} v={audience.industries} on={(v) => setAud('industries', v)} ph="Add an industry…" />
            <Field label="Company Size">
              <div className="flex flex-wrap gap-2">
                {COMPANY_SIZES.map((s) => {
                  const on = audience.companySizes.includes(s);
                  return <button key={s} type="button" onClick={() => setAud('companySizes', on ? audience.companySizes.filter((x) => x !== s) : [...audience.companySizes, s])} className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600'}`}>{s}</button>;
                })}
              </div>
            </Field>
            <AudField label="Departments" sug={DEPT_SUGGEST} v={audience.departments} on={(v) => setAud('departments', v)} ph="Add a department…" />
            <AudField label="Job Titles" sug={TITLE_SUGGEST} v={audience.jobTitles} on={(v) => setAud('jobTitles', v)} ph="Add a job title…" />
            <div className="grid gap-4 sm:grid-cols-2">
              <AudField label="Company keywords (include)" v={audience.companyKeywordsInclude} on={(v) => setAud('companyKeywordsInclude', v)} ph="Include…" />
              <AudField label="Company keywords (exclude)" v={audience.companyKeywordsExclude} on={(v) => setAud('companyKeywordsExclude', v)} ph="Exclude…" />
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step title="Messaging" desc="Design the outreach sequence.">
            <Field label="Type">
              <div className="flex gap-2">
                {(['WITH_CONNECTION', 'DIRECT_MESSAGES'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setOutreachType(t)} className={`rounded-lg border px-3 py-1.5 text-sm ${outreachType === t ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                    {t === 'WITH_CONNECTION' ? 'With Connection' : 'Direct Messages'}
                  </button>
                ))}
              </div>
            </Field>
            {outreachType === 'WITH_CONNECTION' && (
              <div className="mb-3 rounded-xl border border-brand-200 p-4">
                <div className="font-medium text-slate-800">Connection Request</div>
                <div className="mb-2 text-sm text-slate-500">Sent to your targets first.</div>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (leave blank for no note)" />
              </div>
            )}
            {followUps.map((f, i) => (
              <div key={i} className="mb-3 rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium text-slate-800">{outreachType === 'DIRECT_MESSAGES' && i === 0 ? 'First Message' : `Follow-up ${i + 1}`}</div>
                  <div className="flex items-center gap-3 text-sm">
                    {!(outreachType === 'DIRECT_MESSAGES' && i === 0) && (
                      <span>Wait <input type="number" min={0} className="w-16 rounded border border-slate-300 px-2 py-0.5" value={f.waitHours} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, waitHours: Number(e.target.value) } : x))} /> h</span>
                    )}
                    {followUps.length > 1 && <button className="text-rose-500" onClick={() => setFollowUps((fs) => fs.filter((_, j) => j !== i))}>Delete</button>}
                  </div>
                </div>
                <textarea className="input" rows={3} value={f.body} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} />
                <div className="mt-1 text-xs text-slate-400">Tokens: {'{first_name} {last_name} {company} {title}'}</div>
              </div>
            ))}
            <button className="btn-ghost w-full" onClick={() => setFollowUps((fs) => [...fs, { waitHours: 48, body: '' }])}>+ Add message</button>
          </Step>
        )}

        {step === 3 && (
          <Step title="Schedule & Limits" desc="When should the campaign run?">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone">
                <select className="input" value={sched.timezone} onChange={(e) => setSched({ ...sched, timezone: e.target.value })}>
                  {['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" checked={sched.run247} onChange={(e) => setSched({ ...sched, run247: e.target.checked })} /> Run 24/7</label>
            </div>
            {!sched.run247 && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Start hour"><input type="number" min={0} max={23} className="input" value={sched.workStartHour} onChange={(e) => setSched({ ...sched, workStartHour: Number(e.target.value) })} /></Field>
                <Field label="End hour"><input type="number" min={0} max={23} className="input" value={sched.workEndHour} onChange={(e) => setSched({ ...sched, workEndHour: Number(e.target.value) })} /></Field>
              </div>
            )}
            <Field label="Working Days">
              <div className="flex flex-wrap gap-2">
                {DAYS.map(([lbl, d]) => {
                  const on = sched.workDays.includes(d);
                  return <button key={d} type="button" onClick={() => setSched({ ...sched, workDays: on ? sched.workDays.filter((x) => x !== d) : [...sched.workDays, d] })} className={`rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{lbl}</button>;
                })}
              </div>
            </Field>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Daily connections (target)"><input type="number" min={1} className="input" value={sched.dailyConnectionLimit} onChange={(e) => setSched({ ...sched, dailyConnectionLimit: Number(e.target.value) })} /></Field>
              <Field label="Daily messages"><input type="number" min={1} className="input" value={sched.dailyMessageLimit} onChange={(e) => setSched({ ...sched, dailyMessageLimit: Number(e.target.value) })} /></Field>
            </div>

            {/* Warm-up ramp — admin-only tuning (hidden from the client portal) */}
            {!isPortal && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" checked={sched.warmupEnabled} onChange={(e) => setSched({ ...sched, warmupEnabled: e.target.checked })} />
                Warm-up ramp (recommended)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Start with fewer connection requests per day and ramp up to the target gradually — this mimics human
                behaviour and protects the account from LinkedIn&apos;s invite limits and bans.
              </p>
              {sched.warmupEnabled && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Start at (connections/day)"><input type="number" min={1} className="input" value={sched.warmupStartLimit} onChange={(e) => setSched({ ...sched, warmupStartLimit: Number(e.target.value) })} /></Field>
                  <Field label="Ramp to target over (days)"><input type="number" min={1} max={60} className="input" value={sched.warmupDays} onChange={(e) => setSched({ ...sched, warmupDays: Number(e.target.value) })} /></Field>
                  <div className="sm:col-span-2 text-xs text-slate-500">
                    e.g. day 1 ≈ {Math.min(sched.warmupStartLimit, sched.dailyConnectionLimit)}/day → day {sched.warmupDays}+ = {sched.dailyConnectionLimit}/day.
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Background drip-sourcer — auto-refill the Target Audience from LinkedIn search (admin only) */}
            {!isPortal && (
            <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" checked={sched.dripEnabled} onChange={(e) => setSched({ ...sched, dripEnabled: e.target.checked })} />
                Auto-source leads daily (drip)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Automatically pull fresh leads from LinkedIn each day (matching this campaign&apos;s audience) so the
                Target Audience refills as the engine works through it — no manual sourcing needed.
              </p>
              {sched.dripEnabled && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Source up to (leads/day)"><input type="number" min={1} max={200} className="input" value={sched.dripDailyTarget} onChange={(e) => setSched({ ...sched, dripDailyTarget: Number(e.target.value) })} /></Field>
                  <Field label="Keep pending buffer at"><input type="number" min={1} max={1000} className="input" value={sched.dripBuffer} onChange={(e) => setSched({ ...sched, dripBuffer: Number(e.target.value) })} /></Field>
                  <div className="sm:col-span-2 text-xs text-slate-500">
                    Refills only when pending leads drop below {sched.dripBuffer}, up to {sched.dripDailyTarget}/day. If credit metering is on, that&apos;s 1 credit/day.
                  </div>
                </div>
              )}
            </div>
            )}
          </Step>
        )}

        {step === 4 && (
          <Step title="Review & Launch" desc="Confirm before launching.">
            <Row k="Campaign" v={name} />
            <Row k="Account" v={accounts.find((a) => a.id === accountId)?.fullName ?? '—'} />
            <Row k="Type" v={outreachType === 'DIRECT_MESSAGES' ? 'Direct Messages' : 'With Connection'} />
            <Row k="Countries" v={audience.countries.join(', ') || '—'} />
            <Row k="Industries" v={audience.industries.join(', ') || '—'} />
            <Row k="Job Titles" v={audience.jobTitles.join(', ') || '—'} />
            <Row k="Sequence" v={`${buildSteps().length} steps`} />
            <Row k="Schedule" v={sched.run247 ? '24/7' : `${sched.workStartHour}:00–${sched.workEndHour}:00, ${sched.workDays.length} days`} />
            <Row k="Daily limits" v={`${sched.dailyConnectionLimit} connects · ${sched.dailyMessageLimit} messages`} />

            {!isPortal && (
              <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <div className="font-medium text-slate-800">Populate the Target Audience</div>
                <p className="mb-3 text-sm text-slate-500">
                  Pull a first batch of leads (up to 25) from LinkedIn matching the audience above. The engine then
                  contacts them gradually at your daily limits — you can pull more anytime on the campaign page.
                </p>
                <button type="button" className="btn-ghost" disabled={sourcing || saving} onClick={sourceNow}>
                  {sourcing ? 'Sourcing…' : '✦ Source leads from this audience'}
                </button>
                {sourceMsg && <div className="mt-2 text-sm text-emerald-700">{sourceMsg}</div>}
              </div>
            )}
          </Step>
        )}
      </div>

      <div className="mt-4 flex justify-between">
        <button className="btn-ghost" disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>← Back</button>
        {step < STEPS.length - 1 ? (
          <button className="btn-primary" disabled={saving} onClick={next}>{saving ? 'Saving…' : 'Next Step →'}</button>
        ) : editCampaignId ? (
          <button className="btn-primary" disabled={saving} onClick={saveEdit}>{saving ? 'Saving…' : needsReapproval ? '✓ Save & submit for approval' : '✓ Save changes'}</button>
        ) : (
          <button className="btn-primary" disabled={saving} onClick={launch}>{saving ? (launchMode === 'submit' ? 'Submitting…' : 'Launching…') : launchMode === 'submit' ? '✓ Submit for Approval' : '✓ Launch Campaign'}</button>
        )}
      </div>
    </div>
  );
}

function Step({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold text-slate-800">{title}</h2>{desc && <p className="text-sm text-slate-500">{desc}</p>}</div>
      {children}
    </div>
  );
}
function AudField({ label, v, on, sug, ph }: { label: string; v: string[]; on: (v: string[]) => void; sug?: string[]; ph?: string }) {
  return <Field label={label}><LiTagInput value={v} onChange={on} suggestions={sug} placeholder={ph} /></Field>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium text-slate-600">{label}</label>{children}</div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{k}</span><span className="max-w-[60%] text-right font-medium text-slate-800">{v}</span></div>;
}
