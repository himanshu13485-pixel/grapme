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

type StepCondition = 'ANY' | 'IF_ACCEPTED' | 'IF_NOT_ACCEPTED';
interface FollowUp {
  waitHours: number;
  body: string;
  variants: string[];
  condition: StepCondition;
  // "Send only one of this step and the next, at random." Consecutive flagged steps
  // form one random-choice group; buildSteps turns this into shared randomGroup ids.
  randomWithNext: boolean;
}

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
  const [noteVariants, setNoteVariants] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([
    { waitHours: 2, body: 'Hi {first_name}, thanks for connecting. Would love to share how we help teams like {company}.', variants: [], condition: 'IF_ACCEPTED', randomWithNext: false },
  ]);
  // AI message drafting for this step (uses the tenant OpenAI key from My Account).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiForm, setAiForm] = useState({ context: '', followUps: 2, variants: 2 });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');

  async function aiDraftMessages() {
    setAiErr('');
    setAiBusy(true);
    try {
      const res = await api.post<{ steps: { type: string; note?: string; body?: string; waitHours: number; variants?: string[] }[]; source: string }>(
        `${base}/campaigns/draft-messages`,
        { clientId, context: aiForm.context.trim() || undefined, outreachType, followUps: aiForm.followUps, variants: aiForm.variants },
      );
      const conn = res.steps.find((s) => s.type === 'CONNECTION_REQUEST');
      if (outreachType === 'WITH_CONNECTION') {
        setNote(conn?.note ?? '');
        setNoteVariants(cleanVariants(conn?.variants ?? []));
      }
      const msgs = res.steps.filter((s) => s.type === 'MESSAGE');
      if (msgs.length) {
        setFollowUps(msgs.map((s, i) => ({
          waitHours: outreachType === 'DIRECT_MESSAGES' && i === 0 ? 0 : Number(s.waitHours) || 24,
          body: s.body ?? '',
          variants: cleanVariants(s.variants ?? []),
          condition: 'IF_ACCEPTED' as StepCondition,
          randomWithNext: false,
        })));
      }
      setAiOpen(false);
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setAiBusy(false);
    }
  }
  const [sched, setSched] = useState({
    timezone: 'Asia/Kolkata', run247: false, workStartHour: 9, workEndHour: 18,
    workDays: [1, 2, 3, 4, 5] as number[], dailyConnectionLimit: 20, dailyMessageLimit: 20,
    warmupEnabled: true, warmupStartLimit: 5, warmupDays: 14,
    connectionWindowDays: 5,
    dripEnabled: false, dripDailyTarget: 25, dripBuffer: 50,
    followUpMin: 0, followUpMax: 0, graceHours: 96,
    minConnections: 0, maxConnections: 0,
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
        connectionWindowDays: (d as any).connectionWindowDays ?? prev.connectionWindowDays,
        dripEnabled: d.dripEnabled ?? prev.dripEnabled,
        dripDailyTarget: d.dripDailyTarget ?? prev.dripDailyTarget,
        dripBuffer: d.dripBuffer ?? prev.dripBuffer,
        followUpMin: (d as any).followUpMin ?? prev.followUpMin,
        followUpMax: (d as any).followUpMax ?? prev.followUpMax,
        graceHours: (d as any).graceHours ?? prev.graceHours,
        minConnections: (d as any).minConnections ?? prev.minConnections,
        maxConnections: (d as any).maxConnections ?? prev.maxConnections,
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
      const conn = c.steps.find((s) => s.type === 'CONNECTION_REQUEST');
      setNote(conn?.note ?? '');
      setNoteVariants(conn?.variants ?? []);
      const msgSteps = c.steps.filter((s) => s.type === 'MESSAGE');
      const msgs: FollowUp[] = msgSteps.map((s, i) => ({
        waitHours: s.waitHours,
        body: s.body ?? '',
        variants: s.variants ?? [],
        condition: (s.condition ?? 'IF_ACCEPTED') as StepCondition,
        // Grouped with the next step if they share a non-null randomGroup.
        randomWithNext: s.randomGroup != null && msgSteps[i + 1]?.randomGroup === s.randomGroup,
      }));
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
        connectionWindowDays: (c as any).connectionWindowDays ?? prev.connectionWindowDays,
        dripEnabled: c.dripEnabled ?? prev.dripEnabled,
        dripDailyTarget: c.dripDailyTarget ?? prev.dripDailyTarget,
        dripBuffer: c.dripBuffer ?? prev.dripBuffer,
        followUpMin: c.followUpMin ?? prev.followUpMin,
        followUpMax: c.followUpMax ?? prev.followUpMax,
        graceHours: c.graceHours ?? prev.graceHours,
        minConnections: c.minConnections ?? prev.minConnections,
        maxConnections: c.maxConnections ?? prev.maxConnections,
      }));
    }).catch(() => {});
  }, [editCampaignId, base]);

  const setAud = (k: string, v: string[]) => setAudience((a) => ({ ...a, [k]: v }));

  // ── Reusable audience presets ──────────────────────────────────────
  const [presets, setPresets] = useState<{ id: string; name: string; spec: Partial<Audience> }[]>([]);
  const [presetMsg, setPresetMsg] = useState('');
  const specFilledCount = (spec: Partial<Audience> | Audience) =>
    Object.values(spec).filter((v) => Array.isArray(v) && v.length > 0).length;
  function loadPresets() {
    api.get<{ id: string; name: string; spec: Partial<Audience> }[]>(`${base}/clients/${clientId}/audience-presets`).then(setPresets).catch(() => {});
  }
  useEffect(() => { loadPresets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [base, clientId]);
  function applyPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const filled = specFilledCount(p.spec);
    setAudience((a) => {
      const next: Audience = { ...emptyAudience }; // replace, don't merge, so it's a clean load
      for (const [k, v] of Object.entries(p.spec)) {
        if (Array.isArray(v)) (next as Record<string, string[]>)[k] = v as string[];
      }
      return next;
    });
    setPresetMsg(filled > 0 ? `Loaded “${p.name}” — ${filled} field${filled === 1 ? '' : 's'} applied.` : `“${p.name}” has no saved criteria (it was saved empty).`);
    setTimeout(() => setPresetMsg(''), 4000);
  }
  async function savePreset() {
    if (specFilledCount(audience) === 0) {
      alert('Add some audience criteria (countries, industries, job titles…) before saving a preset — otherwise it saves empty.');
      return;
    }
    const nm = window.prompt('Save this audience as a reusable preset — name it:');
    if (!nm?.trim()) return;
    try {
      await api.post(`${base}/clients/${clientId}/audience-presets`, { name: nm.trim(), spec: audience });
      loadPresets();
      setPresetMsg(`Saved “${nm.trim()}”.`);
      setTimeout(() => setPresetMsg(''), 4000);
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to save preset'); }
  }
  async function deletePreset(id: string) {
    if (!confirm('Delete this audience preset?')) return;
    try { await api.del(`${base}/clients/${clientId}/audience-presets/${id}`); loadPresets(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed to delete preset'); }
  }

  async function ensureCampaign() {
    if (campaignId) { await api.patch(`${base}/campaigns/${campaignId}`, { name, outreachType }); return campaignId; }
    const c = await api.post<{ id: string }>(`${base}/campaigns`, { clientId, linkedInAccountId: accountId, name, mode: 'REGULAR', outreachType });
    setCampaignId(c.id); return c.id;
  }

  const cleanVariants = (v: string[]) => v.map((x) => (x ?? '').trim()).filter(Boolean).slice(0, 2);
  // Turn each follow-up's "pick one at random with the next" flag into shared randomGroup
  // ids: a run of consecutive flagged steps (+ the step after it) becomes one group.
  // Only meaningful for WITH_CONNECTION follow-ups.
  function randomGroups(): (number | null)[] {
    const groups: (number | null)[] = followUps.map(() => null);
    if (outreachType !== 'WITH_CONNECTION') return groups;
    let gid = 0;
    for (let i = 0; i < followUps.length - 1; i++) {
      if (followUps[i].randomWithNext) {
        if (groups[i] == null) { gid += 1; groups[i] = gid; }
        groups[i + 1] = groups[i];
      }
    }
    return groups;
  }
  function buildSteps() {
    const steps: any[] = [];
    if (outreachType === 'WITH_CONNECTION') steps.push({ type: 'CONNECTION_REQUEST', waitHours: 0, note: note || undefined, variants: cleanVariants(noteVariants) });
    const groups = randomGroups();
    followUps.forEach((f, i) => steps.push({
      type: 'MESSAGE',
      condition: outreachType === 'WITH_CONNECTION' ? f.condition : 'ANY',
      waitHours: outreachType === 'DIRECT_MESSAGES' && i === 0 ? 0 : Number(f.waitHours),
      body: f.body,
      variants: cleanVariants(f.variants),
      randomGroup: groups[i] ?? undefined,
    }));
    return steps;
  }
  // Distinct follow-up "touches": a random-choice group counts once (one send per lead).
  function messageTouches() {
    return followUps.filter((_, i) => !(outreachType === 'WITH_CONNECTION' && i > 0 && followUps[i - 1].randomWithNext)).length;
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
        ? `✓ Added ${r.sourced} lead${r.sourced === 1 ? '' : 's'} to the Target Audience (query: “${r.keywords}”).${r.creditsCharged ? ` ${r.creditsCharged} credit${r.creditsCharged === 1 ? '' : 's'} used.` : ''} Pull more anytime on the campaign page.`
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

            <Field label="Audience presets">
              <div className="flex flex-wrap items-center gap-2">
                {presets.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-2 text-sm">
                    <button type="button" className="font-medium text-slate-700 hover:text-brand-700" onClick={() => applyPreset(p.id)} title="Load this preset">{p.name}</button>
                    <button type="button" className="text-slate-300 hover:text-rose-600" onClick={() => deletePreset(p.id)} title="Delete preset">✕</button>
                  </span>
                ))}
                <button type="button" className="btn-ghost text-xs" onClick={savePreset}>+ Save current as preset</button>
              </div>
              {presetMsg
                ? <p className="mt-1 text-xs font-medium text-brand-700">{presetMsg}</p>
                : presets.length === 0 && <p className="mt-1 text-xs text-slate-400">Fill in the audience below, then save it to reuse on future campaigns.</p>}
            </Field>
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
              <AudField label="Person keywords (include)" v={audience.personKeywordsInclude} on={(v) => setAud('personKeywordsInclude', v)} ph="e.g. import, sourcing…" />
              <AudField label="Person keywords (exclude)" v={audience.personKeywordsExclude} on={(v) => setAud('personKeywordsExclude', v)} ph="Exclude…" />
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

            {/* AI drafting — staff only; fills the note + follow-ups below, you still review & save. */}
            {!isPortal && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              {!aiOpen ? (
                <button type="button" className="text-sm font-medium text-violet-700 hover:underline" onClick={() => setAiOpen(true)}>
                  ✨ Generate with AI
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-800">✨ Generate messages with AI</div>
                    <button type="button" className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setAiOpen(false)}>Close</button>
                  </div>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="What's this outreach about? (optional — leave blank to use the client's product/service). e.g. Reaching engineering buyers in the UK for brass components."
                    value={aiForm.context}
                    onChange={(e) => setAiForm((f) => ({ ...f, context: e.target.value }))}
                  />
                  <div className="flex flex-wrap items-end gap-4 text-sm">
                    <label className="text-slate-600">Follow-ups
                      <input type="number" min={1} max={5} className="ml-2 w-16 rounded border border-slate-300 px-2 py-0.5" value={aiForm.followUps} onChange={(e) => setAiForm((f) => ({ ...f, followUps: Number(e.target.value) }))} />
                    </label>
                    <label className="text-slate-600">Wordings / step
                      <input type="number" min={1} max={3} className="ml-2 w-16 rounded border border-slate-300 px-2 py-0.5" value={aiForm.variants} onChange={(e) => setAiForm((f) => ({ ...f, variants: Number(e.target.value) }))} />
                    </label>
                    <button type="button" className="btn-primary text-sm" disabled={aiBusy} onClick={aiDraftMessages}>
                      {aiBusy ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">Usually 2 follow-ups (bump to 3 if you like). Fills the fields below — nothing is saved until you finish the wizard.</p>
                  {aiErr && <p className="text-sm text-rose-600">{aiErr}</p>}
                </div>
              )}
            </div>
            )}

            {outreachType === 'WITH_CONNECTION' && (
              <div className="mb-3 rounded-xl border border-brand-200 p-4">
                <div className="font-medium text-slate-800">Connection Request</div>
                <div className="mb-2 text-sm text-slate-500">Sent to your targets first.</div>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (leave blank for no note)" />
                <VariantsEditor variants={noteVariants} onChange={setNoteVariants} rows={2} />
              </div>
            )}
            {followUps.map((f, i) => (
              <div key={i} className="mb-3 rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    {outreachType === 'DIRECT_MESSAGES' && i === 0 ? 'First Message' : `Follow-up ${i + 1}`}
                    {outreachType === 'WITH_CONNECTION' && !isPortal && (f.randomWithNext || (i > 0 && followUps[i - 1].randomWithNext)) && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700" title="Only one step of this random group is sent per lead">🎲 random pick</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {!(outreachType === 'DIRECT_MESSAGES' && i === 0) && (
                      <span className="text-slate-500">Wait <input type="number" min={0} className="w-16 rounded border border-slate-300 px-2 py-0.5" value={f.waitHours} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, waitHours: Number(e.target.value) } : x))} /> h after previous step</span>
                    )}
                    {followUps.length > 1 && <button className="text-rose-500" onClick={() => setFollowUps((fs) => fs.filter((_, j) => j !== i))}>Delete</button>}
                  </div>
                </div>
                {/* Accept-branch routing + random grouping are internal agency strategy — admin only. */}
                {outreachType === 'WITH_CONNECTION' && !isPortal && (
                  <div className="mb-2 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Send this step</span>
                      <select
                        className="rounded border border-slate-300 px-2 py-1"
                        value={f.condition}
                        onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, condition: e.target.value as StepCondition } : x))}
                      >
                        <option value="IF_ACCEPTED">Only if the connection was accepted</option>
                        <option value="ANY">Always — accepted or still pending</option>
                        <option value="IF_NOT_ACCEPTED">Only if not yet accepted (still pending)</option>
                      </select>
                    </div>
                    {i < followUps.length - 1 && (
                      <label className="flex items-start gap-2 text-slate-600">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={f.randomWithNext}
                          onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, randomWithNext: e.target.checked } : x))}
                        />
                        <span>🎲 Send <strong>only one</strong> of this and the next follow-up, picked at random per lead (each keeps its own wait).</span>
                      </label>
                    )}
                  </div>
                )}
                <textarea className="input" rows={3} value={f.body} onChange={(e) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} />
                <div className="mt-1 text-xs text-slate-400">Tokens: {'{first_name} {last_name} {company} {title}'}</div>
                <VariantsEditor variants={f.variants} onChange={(v) => setFollowUps((fs) => fs.map((x, j) => j === i ? { ...x, variants: v } : x))} />
              </div>
            ))}
            <button className="btn-ghost w-full" onClick={() => setFollowUps((fs) => [...fs, { waitHours: 48, body: '', variants: [], condition: 'IF_ACCEPTED', randomWithNext: false }])}>+ Add message</button>
            {outreachType === 'WITH_CONNECTION' && !isPortal && (
              <p className="mt-2 text-xs text-slate-400">
                Follow-ups begin <strong>after the invite is accepted</strong> — LinkedIn only delivers
                DMs to accepted connections — and each wait is counted from the previous step
                (e.g. FU-1 = 2h after acceptance). Tick <em>random pick</em> to send only one of two
                steps at random (e.g. FU-2 at 24h <em>or</em> FU-3 at 48h) for a more human, varied
                cadence. Invites not accepted within the connection window are withdrawn and the lead
                is marked <strong>Not accepted</strong> (no follow-ups).
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              💡 Add alternate wordings to any step — each lead gets one at random, so no message repeats to your
              whole audience (looks human, safer for the account).
            </p>
            <SequenceSummary outreachType={outreachType} note={note} noteVariants={noteVariants} followUps={followUps} />
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
                    Refills only when pending leads drop below {sched.dripBuffer}, up to {sched.dripDailyTarget}/day. If credit metering is on, sourced leads cost 1 credit each.
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Human-likeness — randomized per-lead follow-up count + grace window (admin only) */}
            {!isPortal && (
            <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="text-sm font-medium text-slate-800">Human-likeness</div>
              <p className="mt-1 text-xs text-slate-500">
                Vary how many follow-ups each lead receives so the audience isn&apos;t hit with an identical pattern.
                Set both to 0 to send every configured message to everyone.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Field label="Min follow-ups / lead"><input type="number" min={0} max={10} className="input" value={sched.followUpMin} onChange={(e) => setSched({ ...sched, followUpMin: Number(e.target.value) })} /></Field>
                <Field label="Max follow-ups / lead"><input type="number" min={0} max={10} className="input" value={sched.followUpMax} onChange={(e) => setSched({ ...sched, followUpMax: Number(e.target.value) })} /></Field>
                <Field label="Grace window (hours)"><input type="number" min={0} max={720} className="input" value={sched.graceHours} onChange={(e) => setSched({ ...sched, graceHours: Number(e.target.value) })} /></Field>
                <Field label="Connection accept window (days)"><input type="number" min={1} max={30} className="input" value={sched.connectionWindowDays} onChange={(e) => setSched({ ...sched, connectionWindowDays: Number(e.target.value) })} /></Field>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {sched.followUpMin > 0 && sched.followUpMax >= sched.followUpMin
                  ? `Each lead randomly gets ${sched.followUpMin}–${sched.followUpMax} of your ${messageTouches()} follow-up(s).`
                  : `Every lead gets all ${messageTouches()} follow-up(s).`}
                {' '}After the last message, a lead is marked <strong>Completed</strong> if there&apos;s no reply within {sched.graceHours}h (≈{Math.round(sched.graceHours / 24)}d).
                {' '}A connection invite not accepted within <strong>{sched.connectionWindowDays} day{sched.connectionWindowDays === 1 ? '' : 's'}</strong> is withdrawn and the lead marked <strong>Not accepted</strong>.
              </div>
            </div>
            )}

            {/* Lead-quality gate — only invite well-connected profiles (admin only) */}
            {!isPortal && (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
              <div className="text-sm font-medium text-slate-800">Lead quality — connection count range</div>
              <p className="mt-1 text-xs text-slate-500">
                Only invite profiles whose LinkedIn connection count is within this range. The engine checks each
                profile just before inviting (no extra cost); out-of-range leads are skipped and marked
                <strong> Excluded</strong> — they never use a daily invite slot.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Min</span>
                  <input type="number" min={0} max={100000} step={50} className="input w-32" value={sched.minConnections} onChange={(e) => setSched({ ...sched, minConnections: Math.max(0, Number(e.target.value)) })} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Max</span>
                  <input type="number" min={0} max={100000} step={500} className="input w-32" value={sched.maxConnections} onChange={(e) => setSched({ ...sched, maxConnections: Math.max(0, Number(e.target.value)) })} />
                </div>
                <span className="text-sm text-slate-500">
                  {sched.minConnections > 0 || sched.maxConnections > 0
                    ? `invite ${sched.minConnections > 0 ? `${sched.minConnections}+` : 'any'}${sched.maxConnections > 0 ? ` up to ${sched.maxConnections}` : ''}`
                    : '(0 = off, invite everyone)'}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                <strong>Max</strong> avoids maxed-out profiles (≈25k–30k) that can&apos;t accept invites, so the request
                just fails — e.g. set Max <strong>20000</strong> to skip them. Profiles that hide their count still pass.
                This only reduces who gets invited; it never sends more than your daily cap.
              </div>
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
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{k}</span><span className="max-w-[60%] text-right font-medium text-slate-800">{v}</span></div>;
}

const CONDITION_LABEL: Record<StepCondition, string> = {
  IF_ACCEPTED: 'only if accepted',
  ANY: 'always (accepted or pending)',
  IF_NOT_ACCEPTED: 'only if still pending',
};
function stepTiming(withConn: boolean, i: number, waitHours: number): string {
  if (!withConn && i === 0) return 'sent first';
  if (withConn && i === 0) return `~${waitHours}h after acceptance`;
  return `${waitHours}h after previous step`;
}
function countWordings(primary: string, variants: string[]): number {
  return (primary.trim() ? 1 : 0) + variants.filter((v) => v.trim()).length;
}

/** One numbered row in the flow summary. Rendered as a div so it can nest in groups. */
function SummaryRow({ n, title, meta, timing, done }: { n: number; title: string; meta?: string; timing?: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'}`}>{n}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">
          {title}{timing && <span className="ml-2 text-xs font-normal text-slate-400">· {timing}</span>}
        </div>
        {meta && <div className="text-xs text-slate-500">{meta}</div>}
      </div>
    </div>
  );
}

/**
 * Live, numbered summary of the outreach flow. Step numbers match the engine's
 * currentStep (connection = 1, FU-1 = 2, …). Random-choice groups render as a single
 * "one of these at random" block, and the possible step-number paths are listed
 * (e.g. Step-1/2/3 or Step-1/2/4).
 */
function SequenceSummary({ outreachType, note, noteVariants, followUps }: {
  outreachType: 'WITH_CONNECTION' | 'DIRECT_MESSAGES';
  note: string;
  noteVariants: string[];
  followUps: FollowUp[];
}) {
  const withConn = outreachType === 'WITH_CONNECTION';
  const orderOf = (i: number) => i + 1 + (withConn ? 1 : 0);
  const fuTitle = (i: number) => withConn ? `Follow-up ${i + 1}` : (i === 0 ? 'First message' : `Follow-up ${i}`);
  const fuMeta = (f: FollowUp) => {
    const w = countWordings(f.body, f.variants);
    const cond = withConn ? CONDITION_LABEL[f.condition] : 'always';
    return `${cond}${w > 1 ? ` · ${w} wording variants` : ''}`;
  };

  // Group consecutive random-alternative follow-ups into units of indices.
  const units: number[][] = [];
  if (followUps.length) {
    let cur = [0];
    for (let i = 1; i < followUps.length; i++) {
      if (withConn && followUps[i - 1].randomWithNext) cur.push(i);
      else { units.push(cur); cur = [i]; }
    }
    units.push(cur);
  }
  const completedStep = (withConn ? followUps.length + 1 : Math.max(1, followUps.length)) + 1;

  // Possible step-number paths: connection + one pick per unit (capped for display).
  const paths = units.reduce<number[][]>(
    (acc, unit) => acc.flatMap((a) => unit.map((i) => [...a, orderOf(i)])),
    withConn ? [[1]] : [[]],
  );

  return (
    <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">Flow summary</div>
      <div className="space-y-2">
        {withConn && (
          <SummaryRow n={1} title="Connection request"
            meta={countWordings(note, noteVariants) > 1 ? `${countWordings(note, noteVariants)} wording variants` : (note.trim() ? 'with note' : 'no note')}
            timing="sent first" />
        )}
        {units.map((unit, ui) => unit.length === 1 ? (
          <SummaryRow key={unit[0]} n={orderOf(unit[0])} title={fuTitle(unit[0])} meta={fuMeta(followUps[unit[0]])} timing={stepTiming(withConn, unit[0], followUps[unit[0]].waitHours)} />
        ) : (
          <div key={`g${ui}`} className="rounded-lg border border-violet-200 bg-violet-50/60 p-2">
            <div className="mb-1.5 text-xs font-medium text-violet-700">🎲 One of these, picked at random per lead:</div>
            <div className="space-y-1.5">
              {unit.map((i, k) => (
                <div key={i}>
                  {k > 0 && <div className="my-1 text-center text-xs font-medium text-violet-400">— or —</div>}
                  <SummaryRow n={orderOf(i)} title={fuTitle(i)} meta={fuMeta(followUps[i])} timing={stepTiming(withConn, i, followUps[i].waitHours)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <SummaryRow n={completedStep} title="Completed" timing="grace window passes with no reply" done />
      </div>
      {paths.length > 1 && paths.length <= 8 && (
        <div className="mt-3 text-xs text-slate-500">
          Possible paths:{' '}
          {paths.map((p, i) => (
            <span key={i}>{i > 0 && ' or '}<span className="font-medium text-slate-700">Step-{p.join('/')}</span></span>
          ))}
        </div>
      )}
      <div className="mt-2 text-xs text-slate-500">↩ The flow stops immediately at any stage if the lead replies.</div>
    </div>
  );
}
