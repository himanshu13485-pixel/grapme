'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MousePointer2,
  LayoutGrid,
  Bell,
  Building2,
  User,
  CreditCard,
  Check,
  X,
  Zap,
  Plus,
} from 'lucide-react';

/**
 * Animated multi-scene walkthrough of the GrapMe client portal — a scripted
 * "screen recording" that navigates Dashboard → LinkedIn workspace → Campaigns
 * → live analytics → targeting & limits → email deliverability, then loops.
 * All data is fictional. Stands in until public/media/demo.mp4 exists.
 */

const PHASES = [
  { s: 'dash', id: 'dash-in', d: 1600 },
  { s: 'dash', id: 'dash-nav', d: 950 },
  { s: 'dash', id: 'dash-click', d: 420 },
  { s: 'ws', id: 'ws-in', d: 1700 },
  { s: 'ws', id: 'ws-nav', d: 900 },
  { s: 'ws', id: 'ws-click', d: 420 },
  { s: 'camps', id: 'camps-in', d: 1600 },
  { s: 'camps', id: 'camps-nav', d: 900 },
  { s: 'camps', id: 'camps-click', d: 420 },
  { s: 'detail', id: 'kpis', d: 1600 },
  { s: 'detail', id: 'accept', d: 1500 },
  { s: 'detail', id: 'reply', d: 1500 },
  { s: 'detail', id: 'classify', d: 1400 },
  { s: 'aud', id: 'aud-in', d: 1800 },
  { s: 'aud', id: 'limits', d: 2100 },
  { s: 'email', id: 'email-in', d: 1500 },
  { s: 'email', id: 'checks', d: 2100 },
  { s: 'email', id: 'hold', d: 1500 },
] as const;

type PhaseId = (typeof PHASES)[number]['id'];
type SceneId = (typeof PHASES)[number]['s'];
const SCENES: SceneId[] = ['dash', 'ws', 'camps', 'detail', 'aud', 'email'];
const idx = (id: PhaseId) => PHASES.findIndex((p) => p.id === id);

const CAPTIONS: Record<SceneId, string> = {
  dash: 'Client dashboard',
  ws: 'LinkedIn workspace',
  camps: 'Campaigns',
  detail: 'Live analytics & replies',
  aud: 'Targeting & safe limits',
  email: 'Mailbox deliverability',
};

// cursor position per phase, % of the stage
const CURSOR: Record<PhaseId, { x: number; y: number }> = {
  'dash-in': { x: 55, y: 72 },
  'dash-nav': { x: 10, y: 46 },
  'dash-click': { x: 10, y: 46 },
  'ws-in': { x: 45, y: 60 },
  'ws-nav': { x: 30, y: 88 },
  'ws-click': { x: 30, y: 88 },
  'camps-in': { x: 55, y: 55 },
  'camps-nav': { x: 66, y: 44 },
  'camps-click': { x: 66, y: 44 },
  kpis: { x: 45, y: 32 },
  accept: { x: 80, y: 88 },
  reply: { x: 80, y: 88 },
  classify: { x: 38, y: 60 },
  'aud-in': { x: 48, y: 38 },
  limits: { x: 55, y: 76 },
  'email-in': { x: 84, y: 13 },
  checks: { x: 45, y: 50 },
  hold: { x: 58, y: 72 },
};

/** rAF count-up that runs while `run` is true, resets when it flips false. */
function useTween(target: number, run: boolean, dur = 1000) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) {
      setV(0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, dur]);
  return run ? v : 0;
}

export function DemoMockup() {
  const [i, setI] = useState(0);
  const [sec, setSec] = useState(0);
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (reduced) return;
    if (i === 0) setSec(0);
    const t = setTimeout(() => setI((v) => (v + 1) % PHASES.length), PHASES[i].d);
    return () => clearTimeout(t);
  }, [i, reduced]);

  useEffect(() => {
    if (reduced) return;
    const iv = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [reduced]);

  const phase = PHASES[reduced ? idx('classify') : i];
  const scene: SceneId = phase.s;
  const pid: PhaseId = phase.id;
  const passed = (id: PhaseId) => (reduced ? true : i >= idx(id));
  const cursor = CURSOR[pid];
  const clicking = pid.endsWith('click');

  // tweened numbers per scene
  const dashSent = useTween(1204, scene === 'dash', 1200);
  const dashReplies = useTween(87, scene === 'dash', 1200);
  const wsCredits = useTween(96, scene === 'ws', 1100);
  const wsAi = useTween(64, scene === 'ws', 1100);
  const kConn = useTween(142, scene === 'detail', 1100);
  const kMsg = useTween(214, scene === 'detail', 1100);

  const conn = kConn + (passed('accept') ? 5 : 0);
  const accepted = scene === 'detail' ? 69 + (passed('accept') ? 1 : 0) : 0;
  const replies = 17 + (passed('reply') ? 1 : 0);
  const msgs = kMsg + (passed('reply') ? 2 : 0);
  const pos = 18 + (passed('classify') ? 1 : 0);

  const sceneCls = (s: SceneId) => {
    const cur = SCENES.indexOf(scene);
    const me = SCENES.indexOf(s);
    if (me === cur) return 'opacity-100 translate-x-0';
    return me < cur ? 'opacity-0 -translate-x-4 pointer-events-none' : 'opacity-0 translate-x-4 pointer-events-none';
  };

  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');

  return (
    <div className="relative flex h-full w-full select-none overflow-hidden bg-[#eef1f5] font-sans text-[#0f1626]">
      {/* ============ sidebar (persistent) ============ */}
      <div className="hidden w-[18%] shrink-0 flex-col bg-gradient-to-b from-[#0f5443] to-[#0a3a2f] p-2.5 text-white sm:flex">
        <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-white/10 p-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-white text-[9px] font-black text-[#7c3aed]">G</span>
          <div className="leading-tight">
            <p className="font-grotesk text-[10px] font-bold">GrapMe</p>
            <p className="text-[7px] text-white/50">Client Portal</p>
          </div>
        </div>
        <SideItem icon={LayoutGrid} label="Dashboard" active={scene === 'dash'} />
        <SideItem icon={Bell} label="Updates" />
        <p className="mb-1 mt-2 px-1 text-[7px] font-bold uppercase tracking-wider text-white/40">My workspace</p>
        <div
          className={`flex items-center justify-between rounded-md px-2 py-1.5 transition-all duration-300 ${
            scene !== 'dash' ? 'bg-white text-[#0f5443]' : 'bg-white/[0.07]'
          } ${pid === 'dash-nav' || pid === 'dash-click' ? 'ring-2 ring-[#a78bfa]' : ''}`}
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold">
            <Building2 size={11} /> Northwind
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[7px] font-bold ${scene !== 'dash' ? 'bg-[#0f5443]/10' : 'bg-white/10'}`}>
            Export
          </span>
        </div>
        <p className="mb-1 mt-2 px-1 text-[7px] font-bold uppercase tracking-wider text-white/40">Account</p>
        <SideItem icon={User} label="My Profile" />
        <SideItem icon={CreditCard} label="Membership" />
        <div className="mt-auto flex items-center gap-1.5 rounded-lg bg-white/[0.06] p-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#7c3aed] text-[9px] font-bold text-white">NT</span>
          <div className="leading-tight">
            <p className="text-[9px] font-bold">Northwind Traders</p>
            <p className="text-[7px] text-white/50">Client · Growth</p>
          </div>
        </div>
      </div>

      {/* ============ main stage ============ */}
      <div className="relative flex-1 overflow-hidden">
        {/* REC chip */}
        <div className="absolute right-2.5 top-2.5 z-30 flex items-center gap-1.5 rounded-full bg-[#0f1626]/85 px-2 py-1 backdrop-blur">
          <span className="animate-blink-soft h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
          <span className="font-mono text-[8px] font-bold tracking-wider text-white">REC {mm}:{ss}</span>
        </div>

        {/* scene caption */}
        <div key={scene} className="fade-step absolute bottom-2.5 left-2.5 z-30 flex items-center gap-1.5 rounded-full bg-[#0f1626]/85 px-2.5 py-1 backdrop-blur">
          <span className="font-mono text-[8px] font-bold text-[#a78bfa]">
            {SCENES.indexOf(scene) + 1}/{SCENES.length}
          </span>
          <span className="text-[9px] font-bold text-white">{CAPTIONS[scene]}</span>
        </div>

        {/* ---------- Scene 1 · Dashboard ---------- */}
        <Scene cls={sceneCls('dash')}>
          <p className="font-grotesk text-[15px] font-bold">
            Welcome, <span className="text-[#7c3aed]">Northwind Traders</span>
          </p>
          <p className="mb-2 text-[9px] text-[#64748b]">Your outreach at a glance</p>
          <div className="mb-2 flex items-center justify-between rounded-xl bg-gradient-to-r from-[#0f766e] to-[#0f5443] p-2.5 text-white">
            <div>
              <p className="text-[11px] font-bold">Good evening, Northwind 👋</p>
              <p className="text-[8px] text-white/70">Wishing you a productive day full of new opportunities!</p>
            </div>
            <X size={10} className="text-white/60" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Emails sent" value={dashSent.toLocaleString()} />
            <Stat label="Delivery rate" value="99%" />
            <Stat label="Replies" value={String(dashReplies)} />
            <Stat label="Reply rate" value="24%" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-[#e7eaf0] bg-white p-2.5">
            <div>
              <p className="text-[11px] font-bold">Northwind</p>
              <p className="text-[8px] text-[#64748b]">Validity 30 days · 25 days left</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[8px] font-bold text-[#16a34a]">
                <span className="h-1 w-1 rounded-full bg-[#16a34a]" /> Active
              </span>
              <span className="text-[9px] font-bold text-[#7c3aed]">Open workspace →</span>
            </div>
          </div>
        </Scene>

        {/* ---------- Scene 2 · Workspace (LinkedIn) ---------- */}
        <Scene cls={sceneCls('ws')}>
          <SceneHeader toggle="linkedin" />
          <div className="mb-2 grid grid-cols-4 gap-2">
            <Stat label="Seats" value="2" />
            <Stat label="Credits" value={String(wsCredits)} />
            <Stat label="Plan validity" value="30" sub="days left" />
            <Stat label="AI knowledge" value={`${wsAi}%`} sub="18 profiles" />
          </div>
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" /> 1 of 1 LinkedIn account connected
          </div>
          <div className="flex gap-4 border-b border-[#e7eaf0] px-1 pb-1 text-[10px] font-bold">
            <span
              className={`transition-all ${
                pid === 'ws-nav' || pid === 'ws-click'
                  ? 'rounded bg-[#ede9fe] px-1.5 text-[#7c3aed] ring-2 ring-[#a78bfa]'
                  : 'text-[#7c3aed] underline underline-offset-4'
              }`}
            >
              Campaigns
            </span>
            <span className="text-[#94a3b8]">Schedule</span>
            <span className="text-[#94a3b8]">Inbox</span>
            <span className="text-[#94a3b8]">Accounts&nbsp;1</span>
          </div>
        </Scene>

        {/* ---------- Scene 3 · Campaign list ---------- */}
        <Scene cls={sceneCls('camps')}>
          <SceneHeader toggle="linkedin" />
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1 text-[9px] font-bold">
              <span className="rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-2.5 py-1 text-white">Ongoing</span>
              <span className="px-2 py-1 text-[#64748b]">Completed</span>
              <span className="px-2 py-1 text-[#64748b]">Archived</span>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-2.5 py-1 text-[9px] font-bold text-white">
              <Plus size={9} /> New Campaign
            </span>
          </div>
          <CampRow
            name="Purchase Managers · India"
            seat="Priya Sharma"
            leads="42 leads"
            badge="ACTIVE"
            hot={pid === 'camps-nav' || pid === 'camps-click'}
          />
          <CampRow name="Founders Outreach · EU" seat="Arjun Patel" leads="118 leads" badge="PAUSED" resume />
        </Scene>

        {/* ---------- Scene 4 · Campaign detail ---------- */}
        <Scene cls={sceneCls('detail')}>
          <div className="mb-2 flex items-start justify-between">
            <div>
              <p className="font-grotesk text-[13px] font-bold">Purchase Managers · India</p>
              <p className="text-[8px] text-[#64748b]">Priya Sharma · With Connection</p>
            </div>
            <div className="flex gap-1 rounded-full bg-white p-0.5 text-[8px] font-bold">
              <span className="px-1.5 py-0.5 text-[#94a3b8]">Week</span>
              <span className="px-1.5 py-0.5 text-[#94a3b8]">Month</span>
              <span className="rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-1.5 py-0.5 text-white">Lifetime</span>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-4 gap-2">
            <Stat label="Connections sent" value={String(conn)} sub="in total" hot={pid === 'accept'} />
            <Stat label="Acceptance rate" value="49%" sub={`${accepted} accepted`} hot={pid === 'accept'} />
            <Stat label="Reply rate" value="25%" sub={`${replies} replies`} hot={pid === 'reply'} />
            <Stat label="Total messages" value={String(msgs)} sub="sent & received" hot={pid === 'reply'} />
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <Pill tone="pos" pop={pid === 'classify'}>Positive {pos}</Pill>
            <Pill tone="neu">Neutral 9</Pill>
            <Pill tone="neg">Negative 3</Pill>
            <span className="ml-auto flex items-center gap-1 rounded-full border border-[#e7eaf0] bg-white px-2 py-0.5 text-[8px] font-bold">
              <span className="animate-live-ping h-1.5 w-1.5 rounded-full bg-[#16a34a]" /> Live
            </span>
          </div>
          <div className="rounded-xl border border-[#e7eaf0] bg-white p-2">
            <p className="mb-1 flex items-center gap-1 text-[9px] font-bold">
              <Zap size={10} className="text-[#7c3aed]" /> Live activity
            </p>
            <Feed avatar="RM" name="Rahul Mehta" text="accepted your connection" dot="bg-[#16a34a]" show={passed('accept')} />
            <Feed
              avatar="PN"
              name="Priya Nair"
              text="replied to your message"
              dot="bg-[#7c3aed]"
              show={passed('reply')}
              tag={passed('classify') ? 'Positive' : undefined}
            />
          </div>
          {(pid === 'accept' || pid === 'reply') && (
            <div className="fade-step absolute bottom-8 right-2.5 flex items-center gap-1.5 rounded-xl border border-[#e7eaf0] bg-white px-2.5 py-1.5 shadow-lg">
              <span className={`grid h-5 w-5 place-items-center rounded-full text-white ${pid === 'accept' ? 'bg-[#16a34a]' : 'bg-[#7c3aed]'}`}>
                {pid === 'accept' ? <Check size={11} /> : <span className="text-[7px] font-bold">PN</span>}
              </span>
              <p className="text-[9px] font-semibold">{pid === 'accept' ? 'Rahul Mehta accepted' : 'New reply · Priya Nair'}</p>
            </div>
          )}
        </Scene>

        {/* ---------- Scene 5 · Targeting & limits ---------- */}
        <Scene cls={sceneCls('aud')}>
          <p className="mb-1.5 font-grotesk text-[12px] font-bold">Target Audience</p>
          <div className="mb-2 rounded-xl border border-[#e7eaf0] bg-white p-2.5">
            <ChipRow label="Industries" chips={['Agriculture', 'Manufacturing']} baseDelay={0} />
            <ChipRow label="Company sizes" chips={['Startup (1-10)', 'Medium (51-200)', 'Enterprise (1000+)']} baseDelay={200} />
            <ChipRow label="Job titles" chips={['purchase manager', 'procurement head']} baseDelay={420} last />
          </div>
          <p className="mb-1.5 font-grotesk text-[12px] font-bold">Schedule &amp; Limits</p>
          <div className="grid grid-cols-[1fr,0.9fr] gap-2">
            <div className="rounded-xl border border-[#e7eaf0] bg-white p-2.5 text-[9px]">
              <LimitRow k="Send window" v="9 AM–6 PM · Mon–Sat" />
              <LimitRow k="Daily limits" v="15 connects · 30 messages" />
              <LimitRow k="Warm-up" v="5/day → 15/day over 12 days" />
              <LimitRow k="Timezone" v="Asia/Kolkata" last />
            </div>
            <div className="rounded-xl border border-[#e7eaf0] bg-white p-2.5">
              <p className="mb-1 text-[8px] font-bold text-[#64748b]">Warm-up ramp</p>
              <div className="flex h-12 items-end gap-0.5">
                {Array.from({ length: 12 }, (_, k) => (
                  <span
                    key={k}
                    className={`w-full rounded-sm bg-gradient-to-t from-[#7c3aed] to-[#a78bfa] ${passed('limits') ? 'bar-grow' : 'opacity-0'}`}
                    style={{ height: `${30 + (k / 11) * 70}%`, animationDelay: `${k * 90}ms` }}
                  />
                ))}
              </div>
              <p className="mt-1 text-center text-[7px] text-[#94a3b8]">5 → 15 per day, human pace</p>
            </div>
          </div>
        </Scene>

        {/* ---------- Scene 6 · Email deliverability ---------- */}
        <Scene cls={sceneCls('email')}>
          <SceneHeader toggle="email" hotToggle={pid === 'email-in'} />
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[9px] text-[#64748b]">Mailboxes allocated to this client.</p>
            <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-2.5 py-1 text-[9px] font-bold text-white">
              <Plus size={9} /> Add mailbox
            </span>
          </div>
          <MailboxRow
            name="NW-1"
            addr="hello@nwtraders.com"
            score="100/100"
            checks={[true, true, true]}
            animate={passed('checks')}
            baseDelay={0}
          />
          <MailboxRow
            name="NW SALES"
            addr="sales@nwtraders.com"
            score="67/100"
            checks={[true, true, false]}
            animate={passed('checks')}
            baseDelay={500}
          />
          {passed('hold') && (
            <div className="fade-step mt-2 flex items-center gap-1.5 rounded-xl bg-[#dcfce7] px-2.5 py-1.5 text-[9px] font-bold text-[#15803d]">
              <Check size={11} /> Domain checks run before a single email goes out.
            </div>
          )}
        </Scene>

        {/* animated cursor */}
        {!reduced && (
          <div
            className="pointer-events-none absolute z-40 transition-all duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
          >
            <MousePointer2
              size={16}
              className={`fill-[#0f1626] text-[#0f1626] drop-shadow transition-transform duration-150 ${clicking ? 'scale-75' : 'scale-100'}`}
            />
            {clicking && <span className="absolute -inset-1 animate-ping rounded-full bg-[#7c3aed]/40" />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */

function Scene({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <div className={`absolute inset-0 p-3 transition-all duration-500 ease-out sm:p-3.5 ${cls}`}>{children}</div>;
}

function SceneHeader({ toggle, hotToggle }: { toggle: 'email' | 'linkedin'; hotToggle?: boolean }) {
  return (
    <div className="mb-2 flex items-start justify-between">
      <div>
        <p className="font-grotesk text-[14px] font-bold">Northwind</p>
        <p className="text-[8px] text-[#64748b]">Growth · 10/day · 4 follow-ups · Mon–Sat</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[8px] font-bold text-[#16a34a]">
          <span className="h-1 w-1 rounded-full bg-[#16a34a]" /> Active
        </span>
        <div className={`flex rounded-full bg-white p-0.5 text-[8px] font-bold shadow-sm ${hotToggle ? 'ring-2 ring-[#a78bfa]' : ''}`}>
          <span className={toggle === 'email' ? 'rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-2 py-0.5 text-white' : 'px-2 py-0.5 text-[#94a3b8]'}>
            Email
          </span>
          <span className={toggle === 'linkedin' ? 'rounded-full bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-2 py-0.5 text-white' : 'px-2 py-0.5 text-[#94a3b8]'}>
            LinkedIn
          </span>
        </div>
      </div>
    </div>
  );
}

function SideItem({ icon: Icon, label, active }: { icon: typeof LayoutGrid; label: string; active?: boolean }) {
  return (
    <div
      className={`mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors duration-300 ${
        active ? 'bg-white text-[#0f5443]' : 'text-white/70'
      }`}
    >
      <Icon size={12} /> {label}
    </div>
  );
}

function Stat({ label, value, sub, hot }: { label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-white p-2 transition-all duration-300 ${
        hot ? 'border-[#7c3aed]/50 shadow-[0_6px_18px_-8px_rgba(124,58,237,0.5)]' : 'border-[#e7eaf0]'
      }`}
    >
      <p className="text-[8px] text-[#64748b]">{label}</p>
      <p className="font-grotesk text-[17px] font-bold leading-tight tabular-nums">{value}</p>
      <p className="text-[7px] text-[#94a3b8]">{sub ?? ' '}</p>
    </div>
  );
}

function Pill({ tone, pop, children }: { tone: 'pos' | 'neu' | 'neg'; pop?: boolean; children: React.ReactNode }) {
  const cls = tone === 'pos' ? 'bg-[#dcfce7] text-[#16a34a]' : tone === 'neg' ? 'bg-[#fee2e2] text-[#dc2626]' : 'bg-white text-[#64748b] border border-[#e7eaf0]';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold transition-transform duration-300 ${cls} ${pop ? 'scale-110' : ''}`}>
      {children}
    </span>
  );
}

function CampRow({ name, seat, leads, badge, resume, hot }: { name: string; seat: string; leads: string; badge: 'ACTIVE' | 'PAUSED'; resume?: boolean; hot?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center justify-between rounded-xl border border-[#e7eaf0] bg-white px-2.5 py-2">
      <div>
        <p className="text-[10px] font-bold">{name}</p>
        <p className="flex items-center gap-1 text-[8px] text-[#64748b]">
          <User size={8} /> {seat}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[8px] font-bold">
        <span className="text-[#64748b]">{leads}</span>
        <span className={`rounded-full px-1.5 py-0.5 ${badge === 'ACTIVE' ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef3c7] text-[#b45309]'}`}>{badge}</span>
        <span className={`rounded-md border px-1.5 py-0.5 transition-all duration-300 ${hot ? 'border-[#7c3aed] bg-[#ede9fe] text-[#7c3aed] ring-2 ring-[#a78bfa]' : 'border-[#e7eaf0]'}`}>
          View
        </span>
        <span className="rounded-md border border-[#e7eaf0] px-1.5 py-0.5">Edit</span>
        {resume && <span className="rounded-md bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-1.5 py-0.5 text-white">▶ Resume</span>}
      </div>
    </div>
  );
}

function Feed({ avatar, name, text, dot, show, tag }: { avatar: string; name: string; text: string; dot: string; show: boolean; tag?: string }) {
  return (
    <div className={`mb-1 flex items-center gap-1.5 rounded-lg border border-[#eef1f5] px-2 py-1 transition-all duration-500 ${show ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#eef1f5] text-[7px] font-bold text-[#475569]">{avatar}</span>
      <span className={`h-1 w-1 shrink-0 rounded-full ${dot}`} />
      <p className="text-[8px] leading-tight">
        <span className="font-bold">{name}</span> <span className="text-[#64748b]">{text}</span>
      </p>
      {tag && <span className="fade-step ml-auto rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[7px] font-bold text-[#16a34a]">{tag}</span>}
    </div>
  );
}

function ChipRow({ label, chips, baseDelay, last }: { label: string; chips: string[]; baseDelay: number; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 py-1 ${last ? '' : 'border-b border-[#f1f4f8]'}`}>
      <p className="shrink-0 text-[8px] text-[#94a3b8]">{label}</p>
      <div className="flex flex-wrap justify-end gap-1">
        {chips.map((c, k) => (
          <span key={c} className="fade-step rounded-full bg-[#eef1f5] px-1.5 py-0.5 text-[8px] font-semibold text-[#475569]" style={{ animationDelay: `${baseDelay + k * 120}ms` }}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function LimitRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${last ? '' : 'border-b border-[#f1f4f8]'}`}>
      <span className="text-[#94a3b8]">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}

function MailboxRow({ name, addr, score, checks, animate, baseDelay }: { name: string; addr: string; score: string; checks: boolean[]; animate: boolean; baseDelay: number }) {
  const labels = ['SPF', 'DKIM', 'DMARC'];
  return (
    <div className="mb-1.5 rounded-xl border border-[#e7eaf0] bg-white px-2.5 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold">{name}</p>
          <p className="text-[8px] text-[#64748b]">{addr} · SMTP · cap 200/day</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[7px] font-bold text-[#16a34a]">ACTIVE</span>
          <span className="rounded-md border border-[#e7eaf0] px-1.5 py-0.5 text-[8px] font-bold">Test connection</span>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {labels.map((l, k) =>
          animate ? (
            <span
              key={l}
              className={`fade-step flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[7px] font-bold ${checks[k] ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fee2e2] text-[#dc2626]'}`}
              style={{ animationDelay: `${baseDelay + k * 160}ms` }}
            >
              {l} {checks[k] ? <Check size={7} /> : <X size={7} />}
            </span>
          ) : (
            <span key={l} className="rounded-full bg-[#eef1f5] px-1.5 py-0.5 text-[7px] font-bold text-transparent">
              {l} ·
            </span>
          ),
        )}
        <span className="ml-1 text-[7px] text-[#94a3b8]">score {score}</span>
      </div>
    </div>
  );
}
