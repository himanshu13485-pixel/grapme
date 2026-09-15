import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  LiCampaignStatus, LiLeadStatus, LiScheduledActionStatus, LiScheduledActionType, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_LINKEDIN } from '../../queue/queue.constants';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { LiInboxService } from '../inbox/li-inbox.service';
import { ProfileBudgetExceededError } from '../provider/li-rate-guard.service';
import {
  LiJob, LiJobData, DRIP_SCAN_MS, SYNC_SWEEP_MS, MIN_ACCEPTANCE_SAMPLE,
  MAX_WITHDRAWALS_PER_SWEEP, WITHDRAW_GRACE_DAYS, WITHDRAW_MIN_GAP_MS, WITHDRAW_MAX_GAP_MS,
  reconcileName,
} from './li-queue.constants';

/** Relations pages to scan per sweep (100/page, newest-first) when detecting acceptance. */
const RELATION_SCAN_PAGES = 2;
/** Sent-invitation pages to scan per seat (100/page) when cleaning up stale invites. */
const INVITE_SCAN_PAGES = 3;

/** Wall-clock ceiling for one stale-invite cleanup pass, well under the sweep interval. */
const CLEANUP_TIME_BUDGET_MS = 20 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fisher-Yates, in place. */
function shuffle<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

/** The `/in/<slug>` part of a LinkedIn profile URL, which is the public identifier. */
function publicIdOf(profileUrl: string): string {
  const m = profileUrl.match(/\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}

const TYPE_TO_JOB: Record<LiScheduledActionType, LiJob> = {
  SEND_CONNECTION: LiJob.SendConnection,
  CHECK_ACCEPTANCE: LiJob.CheckAcceptance,
  SEND_MESSAGE: LiJob.SendMessage,
  COMPLETE_LEAD: LiJob.CompleteLead,
};

@Injectable()
export class LiSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(LiSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
    private readonly inbox: LiInboxService,
    // Optional so the platform boots without Redis (scheduler no-ops when absent).
    @Optional() @InjectQueue(QUEUE_LINKEDIN) private readonly queue?: Queue,
  ) {}

  /** Register the repeatable drip-sourcer tick (no-op without Redis). */
  async onModuleInit() {
    if (!this.queue) return;
    // BullMQ keys a repeatable by its interval, so changing one of the constants below
    // ADDS a schedule rather than replacing it — the old cadence keeps firing from Redis
    // forever. Drop any stale schedule for these jobs before registering the current one,
    // or a tightened sweep interval silently never takes effect in production.
    await this.dropStaleRepeatables({ [LiJob.DripSource]: DRIP_SCAN_MS, [LiJob.SyncSweep]: SYNC_SWEEP_MS });
    await this.queue.add(LiJob.DripSource, {}, { repeat: { every: DRIP_SCAN_MS }, removeOnComplete: true, removeOnFail: true });
    await this.queue.add(LiJob.SyncSweep, {}, { repeat: { every: SYNC_SWEEP_MS }, removeOnComplete: true, removeOnFail: true });
    this.logger.log(`LinkedIn drip-sourcer (every ${DRIP_SCAN_MS}ms) + sync sweep (every ${SYNC_SWEEP_MS}ms) registered`);
  }

  /** Remove repeatable schedules for `wanted` jobs whose interval no longer matches. */
  private async dropStaleRepeatables(wanted: Record<string, number>) {
    if (!this.queue) return;
    try {
      for (const r of await this.queue.getRepeatableJobs()) {
        const expected = wanted[r.name];
        if (expected === undefined || r.every === undefined) continue;
        if (Number(r.every) === expected) continue;
        await this.queue.removeRepeatableByKey(r.key);
        this.logger.warn(`Removed stale repeatable ${r.name} (every ${r.every}ms → ${expected}ms)`);
      }
    } catch (e) {
      this.logger.warn(`Could not prune stale repeatables: ${(e as Error).message}`);
    }
  }

  /**
   * Repeatable sweep: re-sync acceptance + message history for every RUNNING campaign,
   * so the panel stays current even if the Unipile messaging webhook misses events or
   * isn't configured. Runs inline (it's already inside a background job).
   */
  async syncSweep() {
    const running = await this.prisma.liCampaign.findMany({ where: { status: LiCampaignStatus.RUNNING }, select: { id: true } });
    for (const c of running) {
      try {
        await this.syncCampaignInline(c.id);
      } catch (e) {
        this.logger.warn(`Sync sweep failed for campaign ${c.id}: ${(e as Error).message}`);
      }
    }
    // Acceptance health runs after the sync, so it judges freshly-resolved statuses.
    await this.enforceAcceptanceHealth().catch((e) =>
      this.logger.warn(`Acceptance health check failed: ${(e as Error).message}`),
    );
    await this.withdrawStaleInvites().catch((e) =>
      this.logger.warn(`Stale-invite cleanup failed: ${(e as Error).message}`),
    );
  }

  /**
   * Withdraw invites that were never accepted and mark their leads NOT_ACCEPTED.
   *
   * The per-lead acceptance ladder already withdraws when a campaign's connection window
   * lapses, but only while that lead still has a live CHECK_ACCEPTANCE job. Anything that
   * lost its job — a paused campaign, a Redis flush, invites sent before the ladder
   * existed — sat pending forever. A large pile of ignored invites is one of the signals
   * LinkedIn weighs against an account, so it is swept independently of the ladder.
   *
   * Runs per seat rather than per campaign: the invite pile belongs to the human whose
   * account sent them, and it needs clearing whether or not the campaign is still running.
   */
  async withdrawStaleInvites(): Promise<number> {
    const seats = await this.prisma.linkedInAccount.findMany({
      where: { status: 'CONNECTED', unipileAccountId: { not: null } },
      select: { id: true, unipileAccountId: true },
    });
    // Deliberately paced withdrawals mean this job's runtime scales with seat count and
    // would eventually outlast its own interval. Bound it by wall clock and take seats in
    // random order, so every seat gets served across sweeps instead of the first N always
    // winning and the rest never being cleaned.
    const deadline = Date.now() + CLEANUP_TIME_BUDGET_MS;
    shuffle(seats);

    let withdrawn = 0;
    for (const seat of seats) {
      if (Date.now() >= deadline) {
        this.logger.log('Stale-invite cleanup hit its time budget; remaining seats resume next sweep');
        break;
      }
      const accountId = seat.unipileAccountId!;
      let retired = 0;
      try {
        // Oldest first: the longest-pending invites are the ones hurting standing most.
        const stale = await this.prisma.liLead.findMany({
          where: {
            status: LiLeadStatus.CONNECTION_PENDING,
            lastActionAt: { not: null },
            campaign: { linkedInAccountId: seat.id },
          },
          select: {
            id: true, unipileMemberId: true, unipileInvitationId: true, lastActionAt: true, profileUrl: true,
            campaign: { select: { connectionWindowDays: true } },
          },
          orderBy: { lastActionAt: 'asc' },
          take: MAX_WITHDRAWALS_PER_SWEEP * 4, // over-fetch: many will not be stale yet
        });

        const due = stale.filter((l) => {
          const windowMs = (Math.max(1, l.campaign.connectionWindowDays ?? 5) + WITHDRAW_GRACE_DAYS) * 864e5;
          return Date.now() - (l.lastActionAt as Date).getTime() >= windowMs;
        }).slice(0, MAX_WITHDRAWALS_PER_SWEEP);
        if (due.length === 0) continue;

        // What LinkedIn still shows as outstanding. An invite missing from this list was
        // accepted or already withdrawn — retire the lead locally without an API call
        // rather than firing a DELETE that can only fail.
        const pending = await this.pendingInvitations(accountId);
        // "Missing from pending" also describes someone who just ACCEPTED. Retiring them
        // as NOT_ACCEPTED would drop a won lead out of the sequence, so check the seat's
        // connections first — a late acceptance is promoted, not binned. runSyncAll covers
        // this for running campaigns; leads on paused ones would otherwise be lost.
        const relations = await this.recentRelationIds(accountId);

        for (const lead of due) {
          if (lead.unipileMemberId && relations.has(lead.unipileMemberId)) {
            await this.prisma.liLead.update({
              where: { id: lead.id },
              data: { status: LiLeadStatus.CONNECTED, connectedAt: new Date(), currentStep: 1 },
            }).catch(() => undefined);
            this.logger.log(`Lead ${lead.id} accepted late — promoted instead of withdrawn`);
            continue;
          }
          const match =
            (lead.unipileMemberId ? pending.byMember.get(lead.unipileMemberId) : undefined) ??
            (lead.profileUrl ? pending.byPublicId.get(publicIdOf(lead.profileUrl)) : undefined);

          // Three states, not two. We only KNOW an invite is gone when the list loaded
          // and the lead had something to match on; otherwise treat it as unknown and
          // fall back to the id recorded at send time.
          const identifiable = !!(lead.unipileMemberId || lead.profileUrl);
          const stillPending = pending.known && identifiable ? !!match : undefined;
          // Prefer the id LinkedIn just gave us over the one stored at send time.
          const invitationId = match ?? lead.unipileInvitationId ?? undefined;

          if (invitationId && stillPending !== false) {
            try {
              await this.provider.withdrawConnection({ accountId, invitationId });
              withdrawn++;
              await sleep(WITHDRAW_MIN_GAP_MS + Math.random() * (WITHDRAW_MAX_GAP_MS - WITHDRAW_MIN_GAP_MS));
            } catch (e) {
              // A withdraw that fails (already gone, expired id) must not strand the lead
              // as pending forever — fall through and retire it locally.
              this.logger.warn(`Withdraw failed for lead ${lead.id}: ${(e as Error).message}`);
            }
          }

          await this.prisma.liLead.update({
            where: { id: lead.id },
            data: { status: LiLeadStatus.NOT_ACCEPTED },
          }).catch(() => undefined);
          await this.cancelPendingChecks(lead.id);
          retired++;
        }
        this.logger.log(`Stale-invite cleanup on seat ${seat.id}: retired ${retired}, withdrawn ${withdrawn}`);
      } catch (e) {
        this.logger.warn(`Stale-invite cleanup failed for seat ${seat.id}: ${(e as Error).message}`);
      }
    }
    return withdrawn;
  }

  /**
   * Invitations LinkedIn still lists as pending for a seat, indexed for lookup.
   *
   * `known: false` means the list couldn't be fetched — callers then fall back to the
   * invitation id we recorded at send time instead of assuming nothing is outstanding.
   */
  private async pendingInvitations(accountId: string): Promise<{
    byMember: Map<string, string>; byPublicId: Map<string, string>; known: boolean;
  }> {
    const byMember = new Map<string, string>();
    const byPublicId = new Map<string, string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < INVITE_SCAN_PAGES; page++) {
        const res = await this.provider.listSentInvitations({ accountId, cursor });
        for (const i of res.items) {
          if (i.memberId) byMember.set(i.memberId, i.invitationId);
          if (i.publicId) byPublicId.set(i.publicId, i.invitationId);
        }
        if (!res.cursor || res.items.length === 0) break;
        cursor = res.cursor;
      }
      return { byMember, byPublicId, known: true };
    } catch (e) {
      this.logger.warn(`listSentInvitations failed for ${accountId}: ${(e as Error).message}`);
      return { byMember, byPublicId, known: false };
    }
  }

  /**
   * Pause campaigns whose invites are being ignored.
   *
   * Pacing fixes the volume LinkedIn sees; it does nothing about *relevance*. A campaign
   * aimed at the wrong people collects ignored invites and "I don't know this person"
   * reports, and that is what escalates a warning into a restricted account — so the
   * engine stops the campaign rather than politely rate-limiting its way into a ban.
   */
  async enforceAcceptanceHealth(): Promise<number> {
    const running = await this.prisma.liCampaign.findMany({
      where: { status: LiCampaignStatus.RUNNING, minAcceptanceRate: { gt: 0 } },
      select: { id: true, name: true, minAcceptanceRate: true, acceptanceGateFrom: true, createdAt: true, outreachType: true },
    });
    let paused = 0;
    for (const c of running) {
      // Direct-message campaigns send no invites, so there is no acceptance to measure.
      if (c.outreachType === 'DIRECT_MESSAGES') continue;
      try {
        const health = await this.acceptanceHealth(c.id, c.acceptanceGateFrom ?? c.createdAt);
        if (health.decided < MIN_ACCEPTANCE_SAMPLE) continue;
        if (health.rate >= c.minAcceptanceRate) continue;

        const reason =
          `Auto-paused: ${health.rate}% acceptance over the last ${health.decided} invites ` +
          `(minimum ${c.minAcceptanceRate}%). Review targeting and the invite note before resuming.`;
        await this.prisma.liCampaign.update({
          where: { id: c.id },
          data: { status: LiCampaignStatus.PAUSED, pausedReason: reason },
        });
        await this.pauseCampaign(c.id);
        this.logger.warn(`Campaign ${c.id} (${c.name}) ${reason}`);
        paused++;
      } catch (e) {
        this.logger.warn(`Acceptance health check failed for campaign ${c.id}: ${(e as Error).message}`);
      }
    }
    return paused;
  }

  /**
   * Acceptance rate over invites actually SENT since `from` that have since been decided.
   *
   * Pending invites are excluded on purpose: an invite nobody has answered yet is not a
   * rejection, and counting it as one would pause every campaign on its first day.
   */
  async acceptanceHealth(campaignId: string, from: Date): Promise<{ accepted: number; decided: number; rate: number }> {
    const invites = await this.prisma.liScheduledAction.findMany({
      where: {
        type: LiScheduledActionType.SEND_CONNECTION,
        status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: from },
        lead: { campaignId },
      },
      select: { lead: { select: { status: true } } },
    });
    // Mirrors the stats definition: anything past CONNECTED counts as accepted.
    const ACCEPTED: LiLeadStatus[] = [
      LiLeadStatus.CONNECTED, LiLeadStatus.MESSAGED, LiLeadStatus.REPLIED, LiLeadStatus.CAMPAIGN_COMPLETED,
    ];
    let accepted = 0;
    let decided = 0;
    for (const i of invites) {
      const s = i.lead?.status;
      if (!s) continue;
      if (ACCEPTED.includes(s)) { accepted++; decided++; }
      else if (s === LiLeadStatus.NOT_ACCEPTED) decided++;
      // CONNECTION_PENDING / EXCLUDED / BOUNCED are undecided — they count for neither.
    }
    return { accepted, decided, rate: decided ? Math.round((accepted / decided) * 100) : 0 };
  }

  /** Guard + run the full sync for one campaign, awaited (used by the sweep). */
  private async syncCampaignInline(campaignId: string) {
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: 'asc' } }, linkedInAccount: true },
    });
    const account = campaign?.linkedInAccount;
    if (!campaign || !account?.unipileAccountId || account.status !== 'CONNECTED') return;
    const where = { campaignId, status: { in: [LiLeadStatus.CONNECTION_PENDING, LiLeadStatus.CONNECTED, LiLeadStatus.MESSAGED] } };
    const firstMsg = campaign.steps.find((s) => s.type === 'MESSAGE');
    await this.runSyncAll(campaignId, account.unipileAccountId, where, firstMsg);
  }

  /** Launch or resume a campaign: enqueue the first action per lead + re-attach orphans. */
  async startCampaign(campaignId: string) {
    if (!this.queue) {
      this.logger.warn(`Scheduler disabled (no Redis) — campaign ${campaignId} marked RUNNING but will not execute`);
      return;
    }
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: 'asc' } }, linkedInAccount: true },
    });
    if (!campaign || campaign.status !== LiCampaignStatus.RUNNING) return;
    if (campaign.steps.length === 0) {
      this.logger.warn(`Campaign ${campaignId} has no sequence steps; nothing to run`);
      return;
    }
    if (campaign.linkedInAccount?.status !== 'CONNECTED') {
      this.logger.warn(`Campaign ${campaignId} has no connected account; cannot run`);
      return;
    }

    // Pull the due day's connection schedule first (idempotent; migrates off any legacy
    // pre-scheduled pile and drops stale past-day invites).
    const scheduled = await this.scheduleDueDays(campaignId);

    // Re-attach only ORPHANED pending actions (Redis job lost to a restart/pause) —
    // follow-ups, acceptance checks, completions. The invites just scheduled above
    // already have live jobs (jobId set), so `jobId: null` skips them (no double-fire).
    const orphans = await this.prisma.liScheduledAction.findMany({
      where: {
        status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
        jobId: null,
        lead: { campaignId },
      },
    });
    for (const a of orphans) {
      await this.attachJob(a.id, a.type, a.leadId, a.stepOrder ?? undefined, a.runAt);
    }
    this.logger.log(`Campaign ${campaignId} (${campaign.outreachType}): scheduled ${scheduled}, re-attached ${orphans.length}`);
  }

  /**
   * Public entry kept for callers (start / source / import): just triggers a due-day
   * pull. In the daily-pull model we do NOT pre-schedule the backlog — leads sit in the
   * pending bucket and only the current/next day is ever scheduled.
   */
  async enqueueNewLeads(campaignId: string): Promise<number> {
    return this.scheduleDueDays(campaignId);
  }

  /** Repeatable tick: pull the due day for every RUNNING campaign (idempotent). */
  async scheduleSweep() {
    await this.cancelTerminalLeadActions().catch(() => undefined);
    const running = await this.prisma.liCampaign.findMany({ where: { status: LiCampaignStatus.RUNNING }, select: { id: true } });
    for (const c of running) {
      try { await this.scheduleDueDays(c.id); }
      catch (e) { this.logger.warn(`Schedule sweep failed for campaign ${c.id}: ${(e as Error).message}`); }
    }
  }

  /**
   * Cancel any still-pending scheduled actions for leads that have left the sequence —
   * REPLIED (a reply stops everything), NOT_ACCEPTED, CAMPAIGN_COMPLETED, EXCLUDED. The
   * processor already skips these at send time, but this clears the queue so their
   * follow-ups don't keep showing as "Scheduled" (also heals leads that reached a
   * terminal state before this rule existed). The delayed job self-skips on the
   * cancelled row, so it need not be removed.
   */
  async cancelTerminalLeadActions(): Promise<number> {
    const res = await this.prisma.liScheduledAction.updateMany({
      where: {
        status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
        lead: { status: { in: [LiLeadStatus.REPLIED, LiLeadStatus.NOT_ACCEPTED, LiLeadStatus.CAMPAIGN_COMPLETED, LiLeadStatus.EXCLUDED] } },
      },
      data: { status: LiScheduledActionStatus.CANCELLED, lastError: 'Lead left the sequence' },
    });
    if (res.count) this.logger.log(`Cancelled ${res.count} stale action(s) for terminal-status leads`);
    return res.count;
  }

  /**
   * Daily-pull scheduler. Schedules exactly `cap` first-invites (connection requests, or
   * first messages for DM campaigns) for the DUE day — today during its window, or the
   * next working day once today's window has closed ("evening pull"). Idempotent: it
   * fills the day only up to `cap`, and skips a day it's already scheduled
   * (scheduledThrough). Clears stale/legacy un-sent invites dated before the target day
   * (this is what migrates a campaign off the old pre-scheduled pile). Returns how many
   * new invites it scheduled.
   */
  async scheduleDueDays(campaignId: string, force = false): Promise<number> {
    if (!this.queue) return 0;
    const c = await this.prisma.liCampaign.findUnique({ where: { id: campaignId }, include: { linkedInAccount: true } });
    if (!c || c.status !== LiCampaignStatus.RUNNING) return 0;
    if (c.linkedInAccount?.status !== 'CONNECTED') return 0;
    const stepCount = await this.prisma.liSequenceStep.count({ where: { campaignId } });
    if (stepCount === 0) return 0;

    const direct = c.outreachType === 'DIRECT_MESSAGES';
    const firstType = direct ? LiScheduledActionType.SEND_MESSAGE : LiScheduledActionType.SEND_CONNECTION;
    const { start, end } = this.targetWindow(c);

    // Idempotent: already pulled this day (or later) → nothing to do. `force` (manual
    // Re-space) bypasses this — the per-day `already` counter below still prevents
    // overfilling, so a forced pull only tops the day up to the cap, never past it.
    if (!force && c.scheduledThrough && c.scheduledThrough.getTime() >= start.getTime()) return 0;

    // Cancel stale/legacy un-sent invites. First run (scheduledThrough null) clears the
    // ENTIRE legacy pre-scheduled pile so the campaign starts clean on the pull model;
    // later runs drop only invites dated before the target day (prior-day leftovers).
    // Their leads return to the pending bucket to be pulled in turn.
    const staleWhere = {
      type: firstType, ...(direct ? { stepOrder: 1 } : {}),
      status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
      ...(c.scheduledThrough ? { runAt: { lt: start } } : {}),
      lead: { campaignId },
    };
    const stale = await this.prisma.liScheduledAction.findMany({ where: staleWhere, select: { id: true, jobId: true } });
    if (stale.length) {
      for (const s of stale) if (s.jobId) await this.queue.remove(s.jobId).catch(() => undefined);
      await this.prisma.liScheduledAction.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: LiScheduledActionStatus.CANCELLED, jobId: null } });
    }

    const cap = Math.max(1, direct ? c.dailyMessageLimit : this.effectiveConnectionCap(c, start));
    // How many first-invites are already scheduled/sent FOR the target day → fill only
    // the remainder, so calling this twice for a day can never exceed the cap.
    const already = await this.prisma.liScheduledAction.count({
      where: { type: firstType, ...(direct ? { stepOrder: 1 } : {}), status: { not: LiScheduledActionStatus.CANCELLED }, runAt: { gte: start, lt: end }, lead: { campaignId } },
    });
    const need = cap - already;
    if (need <= 0) { await this.markScheduled(campaignId, start); return 0; }

    // Pull the next `need` eligible pending leads (oldest first) that have never been
    // invited. (Whether each is <200 connections is only known at send time — the
    // send-time backfill fills any resulting gaps.)
    const leads = await this.prisma.liLead.findMany({
      where: {
        campaignId,
        status: LiLeadStatus.PENDING,
        scheduled: { none: { type: firstType, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED, LiScheduledActionStatus.RUNNING, LiScheduledActionStatus.DONE] } } },
      },
      orderBy: { createdAt: 'asc' },
      take: need,
      select: { id: true },
    });
    const times = this.slotTimesForDate(c, start, end, leads.length);
    for (let i = 0; i < leads.length; i++) {
      if (direct) await this.schedule(leads[i].id, LiScheduledActionType.SEND_MESSAGE, 1, times[i]);
      else await this.schedule(leads[i].id, LiScheduledActionType.SEND_CONNECTION, undefined, times[i]);
    }
    await this.markScheduled(campaignId, start);
    if (leads.length) this.logger.log(`Campaign ${campaignId}: pulled ${leads.length} invite(s) for ${start.toISOString()}`);
    return leads.length;
  }

  private markScheduled(campaignId: string, day: Date) {
    return this.prisma.liCampaign.update({ where: { id: campaignId }, data: { scheduledThrough: day } }).then(() => undefined);
  }

  /**
   * The window we should be scheduling by now: today's window while it's still open,
   * else (evening / after the window closes) the next working day's window.
   */
  private targetWindow(c: { run247: boolean; timezone: string; workStartHour: number; workEndHour: number; workDays: number[] }): { start: Date; end: Date } {
    const windowSecs = c.run247 ? 86_400 : Math.max(1, c.workEndHour - c.workStartHour) * 3600;
    const { hour } = this.localParts(new Date(), c.timezone);
    const afterClose = !c.run247 && hour >= c.workEndHour; // past today's window → schedule next day
    const probe = new Date(this.startOfToday().getTime() + (afterClose ? 864e5 : 0));
    const start = this.nextAllowedSlot(c, probe); // window open of the target working day
    return { start, end: new Date(start.getTime() + windowSecs * 1000) };
  }

  /**
   * Spread `count` sends evenly (one per bucket + jitter) across [max(now,start), end].
   *
   * Guardrail: if too little of today's window is left to space them safely (e.g. the
   * pull/re-space fires late in the day, or after the window has effectively closed),
   * DON'T cram the whole cap into the final minute — that's the "all invites in one
   * minute" burst and a ban risk. Instead roll to the NEXT working day's full window.
   * A hard minimum gap between consecutive sends is enforced as a final safety net.
   */
  private slotTimesForDate(
    c: { run247: boolean; timezone: string; workStartHour: number; workEndHour: number; workDays: number[] },
    start: Date,
    end: Date,
    count: number,
  ): Date[] {
    if (count <= 0) return [];
    const MIN_GAP = 60_000; // ≥ 1 min between consecutive first-invites
    const now = Date.now();
    let startMs = Math.max(start.getTime(), now); // today mid-run → begin at "now"
    let endMs = end.getTime();

    // Not enough room left today to space every send at least MIN_GAP apart → the
    // even spread would degenerate into a burst. Move to the next working day's window.
    if (endMs - startMs < count * MIN_GAP) {
      const windowSecs = c.run247 ? 86_400 : Math.max(1, c.workEndHour - c.workStartHour) * 3600;
      const nextStart = this.nextAllowedSlot(c, this.tomorrow());
      startMs = nextStart.getTime();
      endMs = startMs + windowSecs * 1000;
    }

    const span = endMs - startMs;
    const bucket = span / count;
    const times: Date[] = [];
    let prev = 0;
    for (let i = 0; i < count; i++) {
      let t = startMs + i * bucket + Math.random() * bucket;
      if (i > 0 && t - prev < MIN_GAP) t = prev + MIN_GAP; // never closer than MIN_GAP
      prev = t;
      times.push(new Date(t));
    }
    return times;
  }

  /**
   * Send-time backfill: atomically claim the next eligible pending lead (oldest first,
   * no invite yet) and schedule its connection request ~now (+20–90s jitter so a run of
   * substitutions doesn't fire together). Returns false when the bucket has no eligible
   * lead left. Used to fill a slot freed by a <min-connections exclusion.
   */
  async claimNextConnection(campaignId: string): Promise<boolean> {
    if (!this.queue) return false;
    // Fire the substitute ~now, but never outside the send window — a backfill triggered
    // late in the day (or a chain of exclusions) must not push invites past working hours.
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      select: { run247: true, timezone: true, workStartHour: true, workEndHour: true, workDays: true },
    });
    const desired = new Date(Date.now() + (20 + Math.random() * 70) * 1000);
    const runAt = campaign ? this.nextAllowedSlot(campaign, desired) : desired;
    const created = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.liLead.findFirst({
        where: {
          campaignId,
          status: LiLeadStatus.PENDING,
          scheduled: { none: { type: LiScheduledActionType.SEND_CONNECTION, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED, LiScheduledActionStatus.RUNNING, LiScheduledActionStatus.DONE] } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!lead) return null;
      return tx.liScheduledAction.create({ data: { leadId: lead.id, type: LiScheduledActionType.SEND_CONNECTION, runAt, status: LiScheduledActionStatus.PENDING } });
    });
    if (!created) return false;
    await this.attachJob(created.id, LiScheduledActionType.SEND_CONNECTION, created.leadId, undefined, runAt);
    return true;
  }

  /**
   * At-a-glance schedule status for the campaign card: today's sent/planned vs cap, the
   * next working day's planned count, the pending-bucket size, and scheduledThrough.
   */
  async scheduleStatus(campaignId: string) {
    const c = await this.prisma.liCampaign.findUnique({ where: { id: campaignId } });
    if (!c) return null;
    const direct = c.outreachType === 'DIRECT_MESSAGES';
    const firstType = direct ? LiScheduledActionType.SEND_MESSAGE : LiScheduledActionType.SEND_CONNECTION;
    const stepFilter = direct ? { stepOrder: 1 } : {};
    const windowSecs = c.run247 ? 86_400 : Math.max(1, c.workEndHour - c.workStartHour) * 3600;
    const capFor = (asOf: Date) => (direct ? c.dailyMessageLimit : this.effectiveConnectionCap(c, asOf));
    const dayCount = (s: Date, e: Date, doneOnly = false) =>
      this.prisma.liScheduledAction.count({
        where: {
          type: firstType, ...stepFilter,
          ...(doneOnly ? { status: LiScheduledActionStatus.DONE } : { status: { not: LiScheduledActionStatus.CANCELLED } }),
          runAt: { gte: s, lt: e }, lead: { campaignId },
        },
      });

    const isWorkingToday = c.run247 || c.workDays.includes(this.localParts(new Date(), c.timezone).day);
    let today: { date: Date; scheduled: number; sent: number; cap: number } | null = null;
    if (isWorkingToday) {
      const s = this.nextAllowedSlot(c, this.startOfToday());
      const e = new Date(s.getTime() + windowSecs * 1000);
      today = { date: s, scheduled: await dayCount(s, e), sent: await dayCount(s, e, true), cap: capFor(s) };
    }
    const ns = this.nextAllowedSlot(c, new Date(this.startOfToday().getTime() + 864e5));
    const ne = new Date(ns.getTime() + windowSecs * 1000);
    const next = { date: ns, scheduled: await dayCount(ns, ne), cap: capFor(ns) };
    const pending = await this.prisma.liLead.count({ where: { campaignId, status: LiLeadStatus.PENDING } });
    return { scheduledThrough: c.scheduledThrough, today, next, pending };
  }

  /** Count first-invite actions already scheduled for today (used to continue the cadence). */
  private firstActionsPlacedToday(campaignId: string, direct: boolean): Promise<number> {
    return this.prisma.liScheduledAction.count({
      where: {
        type: direct ? LiScheduledActionType.SEND_MESSAGE : LiScheduledActionType.SEND_CONNECTION,
        ...(direct ? { stepOrder: 1 } : {}),
        status: { not: LiScheduledActionStatus.CANCELLED },
        runAt: { gte: this.startOfToday(), lt: this.tomorrow() },
        lead: { campaignId },
      },
    });
  }

  /**
   * Working-day-aware send-time allocator. Returns `count` times, giving each WORKING
   * day exactly `limit` slots spread evenly across the send window (with a small ±
   * jitter), and SKIPPING non-working days — so a weekend's allotment never collapses
   * onto the next working day and overloads it. Day 0 (today) starts past both the
   * already-used slots (`placedToday`) and any now-elapsed time, so nothing bunches or
   * schedules in the past. Shared by fresh enqueue and the re-space action.
   */
  private allocateSlotTimes(
    campaign: { run247: boolean; timezone: string; workStartHour: number; workEndHour: number; workDays: number[]; jitterMinSeconds?: number | null; jitterMaxSeconds?: number | null },
    limit: number,
    count: number,
    placedToday: number,
  ): Date[] {
    const MIN_GAP = 60_000; // ≥ 1 min between consecutive first-invites (anti-burst)
    const windowSecs = campaign.run247 ? 86_400 : Math.max(1, campaign.workEndHour - campaign.workStartHour) * 3600;
    const baseSpacing = windowSecs / limit;
    const jMin = Math.max(0, campaign.jitterMinSeconds ?? 20);
    const jMax = Math.max(jMin, campaign.jitterMaxSeconds ?? 90);
    const wobble = () => (jMin + Math.random() * (jMax - jMin)) * (Math.random() < 0.5 ? -1 : 1);
    const now = Date.now();
    const midnightOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const times: Date[] = [];
    let probe = this.startOfToday();
    let dayIdx = 0;
    while (times.length < count) {
      const winStart = this.nextAllowedSlot(campaign, probe); // next working day's window open
      const winStartMs = winStart.getTime();
      let startSlot = 0;
      if (dayIdx === 0) {
        const elapsed = Math.ceil((now - winStartMs) / (baseSpacing * 1000));
        startSlot = Math.max(placedToday, Math.max(0, elapsed));
      }
      for (let slot = startSlot; slot < limit && times.length < count; slot++) {
        const t = winStartMs + (slot * baseSpacing + wobble()) * 1000;
        let clamped = Math.max(t, now); // never in the past
        // Safety net: if several early slots clamp onto `now`, keep them ≥ MIN_GAP apart
        // so a late re-space can't fire a burst within the same minute.
        const prev = times[times.length - 1]?.getTime() ?? 0;
        if (times.length && dayIdx === 0 && clamped - prev < MIN_GAP) clamped = prev + MIN_GAP;
        times.push(new Date(clamped));
      }
      probe = new Date(midnightOf(winStart).getTime() + 864e5); // day after; skips off-days
      dayIdx++;
    }
    return times;
  }

  /**
   * Re-space a campaign's still-pending first invites across working days using the
   * current pacing rules — fixes queues built by older logic that piled invites onto a
   * single day. Only touches PENDING/QUEUED connection requests (direct: first messages)
   * that haven't sent; follow-ups (anchored to acceptance) are left alone.
   */
  async respaceCampaign(campaignId: string): Promise<{ ok: boolean; respaced: number; message?: string }> {
    if (!this.queue) return { ok: false, respaced: 0, message: 'Sending engine is off (no Redis).' };
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { linkedInAccount: true },
    });
    if (!campaign) return { ok: false, respaced: 0, message: 'Campaign not found.' };
    const direct = campaign.outreachType === 'DIRECT_MESSAGES';
    const firstType = direct ? LiScheduledActionType.SEND_MESSAGE : LiScheduledActionType.SEND_CONNECTION;
    const actions = await this.prisma.liScheduledAction.findMany({
      where: {
        type: firstType,
        ...(direct ? { stepOrder: 1 } : {}),
        status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
        lead: { campaignId },
      },
      orderBy: { runAt: 'asc' },
      select: { id: true, jobId: true, leadId: true, stepOrder: true },
    });
    if (actions.length === 0) {
      // Nothing scheduled yet — e.g. the campaign was paused when the evening pull ran,
      // so the day's invites were never created. Instead of no-opping, build the due-day
      // schedule now from the pending bucket (force past the idempotency guard).
      const pulled = await this.scheduleDueDays(campaignId, true);
      if (pulled > 0) {
        return { ok: true, respaced: pulled, message: `Scheduled ${pulled} invite(s) for the next working day from the pending bucket.` };
      }
      const reason =
        campaign.status !== LiCampaignStatus.RUNNING ? 'Campaign is paused — resume it, then Re-space.'
        : campaign.linkedInAccount?.status !== 'CONNECTED' ? 'The LinkedIn account is not connected.'
        : 'No pending leads available to schedule (bucket empty or the day is already full).';
      return { ok: true, respaced: 0, message: reason };
    }

    // De-duplicate: keep at most ONE pending first-invite per lead (earliest), cancel the
    // rest. Extras accumulate from a lead sourced twice or older buggy scheduling and
    // would invite the same person more than once.
    const keep: typeof actions = [];
    const dupes: typeof actions = [];
    const seen = new Set<string>();
    for (const a of actions) {
      if (seen.has(a.leadId)) dupes.push(a);
      else { seen.add(a.leadId); keep.push(a); }
    }
    if (dupes.length) {
      for (const d of dupes) if (d.jobId) await this.queue.remove(d.jobId).catch(() => undefined);
      await this.prisma.liScheduledAction.updateMany({
        where: { id: { in: dupes.map((d) => d.id) } },
        data: { status: LiScheduledActionStatus.CANCELLED, jobId: null },
      });
    }

    const limit = Math.max(1, direct ? campaign.dailyMessageLimit : this.effectiveConnectionCap(campaign));
    // Count invites already SENT today so re-spacing doesn't overfill today.
    const sentToday = await this.prisma.liScheduledAction.count({
      where: {
        type: firstType, ...(direct ? { stepOrder: 1 } : {}),
        status: LiScheduledActionStatus.DONE,
        runAt: { gte: this.startOfToday(), lt: this.tomorrow() },
        lead: { campaignId },
      },
    });
    const times = this.allocateSlotTimes(campaign, limit, keep.length, sentToday);
    for (let i = 0; i < keep.length; i++) {
      const a = keep[i];
      if (a.jobId) await this.queue.remove(a.jobId).catch(() => undefined);
      await this.prisma.liScheduledAction.update({
        where: { id: a.id },
        data: { status: LiScheduledActionStatus.PENDING, runAt: times[i], jobId: null },
      });
      await this.attachJob(a.id, firstType, a.leadId, a.stepOrder ?? undefined, times[i]);
    }
    this.logger.log(`Re-spaced ${keep.length} invites for campaign ${campaignId}${dupes.length ? ` (cancelled ${dupes.length} duplicate)` : ''}`);
    return {
      ok: true,
      respaced: keep.length,
      message: dupes.length ? `Re-spaced ${keep.length} invite(s) across working days and removed ${dupes.length} duplicate(s).` : undefined,
    };
  }

  async pauseCampaign(campaignId: string) {
    if (!this.queue) return;
    const actions = await this.prisma.liScheduledAction.findMany({
      where: {
        status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
        jobId: { not: null },
        lead: { campaignId },
      },
      select: { id: true, jobId: true },
    });
    for (const a of actions) if (a.jobId) await this.queue.remove(a.jobId).catch(() => undefined);
    await this.prisma.liScheduledAction.updateMany({
      where: { id: { in: actions.map((a) => a.id) } },
      data: { status: LiScheduledActionStatus.PENDING, jobId: null },
    });
    this.logger.log(`Campaign ${campaignId} paused: removed ${actions.length} jobs`);
  }

  /** Remove any queued/delayed jobs for a lead (before deleting it). */
  async removeLeadJobs(leadId: string) {
    if (!this.queue) return;
    const actions = await this.prisma.liScheduledAction.findMany({
      where: { leadId, jobId: { not: null } },
      select: { jobId: true },
    });
    for (const a of actions) if (a.jobId) await this.queue.remove(a.jobId).catch(() => undefined);
  }

  /** Create a ScheduledAction row and enqueue its delayed job (used by the processor too). */
  async schedule(leadId: string, type: LiScheduledActionType, stepOrder: number | undefined, runAt: Date) {
    const finalRunAt = await this.gate(leadId, runAt);
    const action = await this.prisma.liScheduledAction.create({
      data: { leadId, type, stepOrder, runAt: finalRunAt, status: LiScheduledActionStatus.PENDING },
    });
    await this.attachJob(action.id, type, leadId, stepOrder, finalRunAt);
    return action;
  }

  async rearm(actionId: string, runAt: Date) {
    const existing = await this.prisma.liScheduledAction.findUniqueOrThrow({ where: { id: actionId }, select: { leadId: true } });
    const finalRunAt = await this.gate(existing.leadId, runAt);
    const action = await this.prisma.liScheduledAction.update({
      where: { id: actionId },
      data: { status: LiScheduledActionStatus.PENDING, runAt: finalRunAt, attempts: { increment: 1 } },
    });
    await this.attachJob(action.id, action.type, action.leadId, action.stepOrder ?? undefined, finalRunAt);
  }

  /**
   * Admin test helper: fire the campaign's SINGLE next pending action immediately,
   * bypassing the send-window gate. The processor still enforces the daily cap, so
   * this can't be abused to blow past safe volume.
   */
  async runNext(campaignId: string): Promise<{ ok: boolean; message?: string }> {
    if (!this.queue) return { ok: false, message: 'Sending engine is off (no Redis).' };
    const action = await this.prisma.liScheduledAction.findFirst({
      where: { status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] }, lead: { campaignId } },
      orderBy: { runAt: 'asc' },
      select: { id: true, type: true, leadId: true, stepOrder: true, jobId: true },
    });
    if (!action) return { ok: false, message: 'No pending action to send.' };
    if (action.jobId) await this.queue.remove(action.jobId).catch(() => undefined);
    const now = new Date();
    await this.prisma.liScheduledAction.update({
      where: { id: action.id },
      data: { status: LiScheduledActionStatus.PENDING, runAt: now, jobId: null },
    });
    await this.attachJob(action.id, action.type, action.leadId, action.stepOrder ?? undefined, now);
    return { ok: true };
  }

  /**
   * Admin "Send now" for ONE lead: run its next action immediately. If the lead has
   * never started (or its only attempt died), its first action is created on the
   * spot. Working hours are bypassed (this is a deliberate manual trigger), but the
   * daily connection/message caps and the warm-up ramp are NOT — the processor
   * re-arms to tomorrow if today's allowance is already used up.
   */
  async runNowForLead(campaignId: string, leadId: string): Promise<{ ok: boolean; message?: string }> {
    if (!this.queue) return { ok: false, message: 'Sending engine is off (no Redis).' };
    const lead = await this.prisma.liLead.findFirst({
      where: { id: leadId, campaignId },
      select: { id: true, status: true },
    });
    if (!lead) return { ok: false, message: 'Lead not found in this campaign.' };

    const now = new Date();
    const action = await this.prisma.liScheduledAction.findFirst({
      where: { leadId, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] } },
      orderBy: { runAt: 'asc' },
      select: { id: true, type: true, stepOrder: true, jobId: true },
    });
    if (action) {
      if (action.jobId) await this.queue.remove(action.jobId).catch(() => undefined);
      await this.prisma.liScheduledAction.update({
        where: { id: action.id },
        data: { status: LiScheduledActionStatus.PENDING, runAt: now, jobId: null },
      });
      await this.attachJob(action.id, action.type, leadId, action.stepOrder ?? undefined, now);
      return { ok: true };
    }

    // Nothing queued for this lead — kick off its first action if it hasn't begun.
    if (lead.status !== LiLeadStatus.PENDING) {
      return { ok: false, message: 'This lead has no pending action left.' };
    }
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: true, linkedInAccount: true },
    });
    if (!campaign || campaign.status !== LiCampaignStatus.RUNNING) {
      return { ok: false, message: 'Start the campaign first.' };
    }
    if (campaign.steps.length === 0) return { ok: false, message: 'Add a message sequence first.' };
    if (campaign.linkedInAccount?.status !== 'CONNECTED') {
      return { ok: false, message: "The campaign's LinkedIn account isn't connected — reconnect the seat first." };
    }
    const direct = campaign.outreachType === 'DIRECT_MESSAGES';
    const created = await this.prisma.liScheduledAction.create({
      data: {
        leadId,
        type: direct ? LiScheduledActionType.SEND_MESSAGE : LiScheduledActionType.SEND_CONNECTION,
        stepOrder: direct ? 1 : null,
        runAt: now,
        status: LiScheduledActionStatus.PENDING,
      },
    });
    await this.attachJob(created.id, created.type, leadId, created.stepOrder ?? undefined, now);
    return { ok: true };
  }

  /**
   * Admin "Sync from LinkedIn": for a campaign's in-flight leads, refresh the real
   * profile (fixes URL-slug names + fills title/company) and check whether the
   * connection was accepted — accepted leads flip to CONNECTED and their first
   * message is scheduled immediately, instead of waiting for the periodic poll.
   */
  // Above this many leads, run the sync in the background so the HTTP request (and the
  // reverse-proxy) doesn't time out on hundreds of provider calls.
  private static readonly SYNC_INLINE_MAX = 200;

  async syncConnections(campaignId: string): Promise<{ ok: boolean; started?: boolean; total: number; checked: number; accepted: number; refreshed: number; messagesSynced: number; message?: string }> {
    const zero = { checked: 0, accepted: 0, refreshed: 0, messagesSynced: 0 };
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: 'asc' } }, linkedInAccount: true },
    });
    if (!campaign) return { ok: false, total: 0, ...zero, message: 'Campaign not found' };
    const account = campaign.linkedInAccount;
    if (!account?.unipileAccountId || account.status !== 'CONNECTED') {
      return { ok: false, total: 0, ...zero, message: 'Connect the LinkedIn account before syncing.' };
    }
    const accountId = account.unipileAccountId;
    const where = { campaignId, status: { in: [LiLeadStatus.CONNECTION_PENDING, LiLeadStatus.CONNECTED, LiLeadStatus.MESSAGED] } };
    const total = await this.prisma.liLead.count({ where });
    if (total === 0) return { ok: true, total: 0, ...zero };
    const firstMsg = campaign.steps.find((s) => s.type === 'MESSAGE');

    // Large audiences: kick off in the background and return immediately.
    if (total > LiSchedulerService.SYNC_INLINE_MAX) {
      void this.runSyncAll(campaignId, accountId, where, firstMsg)
        .catch((e) => this.logger.error(`Background sync ${campaignId} failed: ${(e as Error).message}`));
      return { ok: true, started: true, total, ...zero };
    }
    const res = await this.runSyncAll(campaignId, accountId, where, firstMsg);
    return { ok: true, total, ...res };
  }

  /** Paginate the WHOLE matching audience (cursor-based — safe as statuses change) and
   *  for each lead: refresh profile, check acceptance, and backfill chat history. */
  private async runSyncAll(
    campaignId: string,
    accountId: string,
    where: Prisma.LiLeadWhereInput,
    firstMsg?: { order: number; waitHours: number; type: string },
  ): Promise<{ checked: number; accepted: number; refreshed: number; messagesSynced: number }> {
    // One pass over the seat's chats → member id → chat id, so we can backfill history
    // even for conversations the engine never started (manual messages). Best-effort.
    const chatByMember = new Map<string, string>();
    try {
      for (const c of await this.provider.listChats({ accountId })) {
        for (const mid of c.memberIds) if (!chatByMember.has(mid)) chatByMember.set(mid, c.chatId);
      }
    } catch (e) {
      this.logger.warn(`listChats failed for ${accountId}: ${(e as Error).message}`);
    }

    // One pass over the seat's most recent 1st-degree connections. Acceptance is then a
    // local set lookup instead of a profile read per pending lead — the difference
    // between ~1 provider call per sweep and one per in-flight invite, which is what
    // got a seat flagged for reading "a high volume of profile data". Relations come
    // back newest-first, so recent acceptances are on the first pages.
    const relations = await this.recentRelationIds(accountId);

    let checked = 0; let accepted = 0; let refreshed = 0; let messagesSynced = 0;
    let budgetOut = false;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.liLead.findMany({
        where,
        include: { conversation: { select: { unipileChatId: true } } },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const lead of batch) {
        try {
          let memberId = lead.unipileMemberId ?? undefined;
          // Resolve only when we actually lack the member id — that is the one thing the
          // engine cannot act without, and once we have it the lead is never re-fetched.
          //
          // This used to also re-resolve whenever a name still looked like a URL slug,
          // which never terminated: if LinkedIn returns no usable first name (restricted
          // or incomplete profile), the lead still looks unresolved afterwards, so every
          // sweep fetched it again forever. A handful of such leads was enough to spend
          // the seat's whole daily profile budget on cosmetics. Having a member id means
          // we already fetched that profile at least once; asking again cannot produce a
          // name it did not have.
          if (lead.profileUrl && !memberId) {
            const m = await this.provider.resolveMember(accountId, lead.profileUrl);
            memberId = m.memberId ?? memberId;
            const name = reconcileName(lead, m);
            await this.prisma.liLead.update({
              where: { id: lead.id },
              data: {
                unipileMemberId: memberId,
                fullName: name.fullName || lead.fullName,
                firstName: name.firstName,
                lastName: name.lastName,
                title: lead.title ?? m.title,
                company: lead.company ?? m.company,
                location: lead.location ?? m.location,
                avatarUrl: lead.avatarUrl ?? m.avatarUrl,
              },
            });
            refreshed++;
          }
          if (lead.status === LiLeadStatus.CONNECTION_PENDING && memberId) {
            checked++;
            // Set lookup, not a provider call. When the relations pass failed outright
            // (empty set) we skip rather than fall back to per-lead profile reads — the
            // per-lead CHECK_ACCEPTANCE ladder is the backstop, and it is budget-metered.
            const isAcc = relations.size > 0 && relations.has(memberId);
            if (isAcc) {
              await this.prisma.liLead.update({ where: { id: lead.id }, data: { status: LiLeadStatus.CONNECTED, connectedAt: new Date(), currentStep: 1 } });
              await this.cancelPendingChecks(lead.id);
              // Kick off the first message; the processor handles subsequent steps.
              if (firstMsg && !(await this.hasScheduledMessage(lead.id))) {
                await this.schedule(lead.id, LiScheduledActionType.SEND_MESSAGE, firstMsg.order, new Date(Date.now() + firstMsg.waitHours * 3600 * 1000));
              }
              accepted++;
            }
          }
          // Backfill the full conversation (both directions) if we can find its chat —
          // surfaces manually-exchanged messages and marks replies. If they replied, the
          // processor skips any first message we just queued (REPLIED leads are gated).
          const chatId = lead.conversation?.unipileChatId ?? (memberId ? chatByMember.get(memberId) : undefined);
          if (chatId) messagesSynced += await this.inbox.backfillLeadMessages(lead.id, accountId, chatId);
        } catch (e) {
          if (e instanceof ProfileBudgetExceededError) {
            // The seat is out of profile-read budget for today. Stop the whole sweep
            // rather than grinding through the remaining leads throwing per lead —
            // the next sweep picks up where this one left off.
            this.logger.warn(`Sync for campaign ${campaignId} halted: ${e.message}`);
            budgetOut = true;
            break;
          }
          this.logger.warn(`Sync failed for lead ${lead.id}: ${(e as Error).message}`);
        }
      }
      if (budgetOut) break;
      cursor = batch[batch.length - 1].id;
      if (batch.length < 100) break;
    }
    this.logger.log(`Sync campaign ${campaignId}: checked ${checked}, accepted ${accepted}, refreshed ${refreshed}, messages ${messagesSynced}`);
    return { checked, accepted, refreshed, messagesSynced };
  }

  /**
   * Member ids of the seat's most recently added 1st-degree connections.
   *
   * Deliberately capped: LinkedIn's relations list is newest-first, so a couple of
   * pages covers every invite accepted since the last sweep. Paging the whole network
   * would trade one flood of provider calls for another.
   */
  private async recentRelationIds(accountId: string, maxPages = RELATION_SCAN_PAGES): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      try {
        const res = await this.provider.listRelations({ accountId, cursor });
        for (const p of res.people) if (p.memberId) ids.add(p.memberId);
        if (!res.cursor || res.people.length === 0) break;
        cursor = res.cursor;
      } catch (e) {
        this.logger.warn(`listRelations page ${page} failed for ${accountId}: ${(e as Error).message}`);
        break;
      }
    }
    return ids;
  }

  private async cancelPendingChecks(leadId: string) {
    const actions = await this.prisma.liScheduledAction.findMany({
      where: { leadId, type: LiScheduledActionType.CHECK_ACCEPTANCE, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] } },
      select: { id: true, jobId: true },
    });
    for (const a of actions) if (a.jobId && this.queue) await this.queue.remove(a.jobId).catch(() => undefined);
    if (actions.length) {
      await this.prisma.liScheduledAction.updateMany({
        where: { id: { in: actions.map((a) => a.id) } },
        data: { status: LiScheduledActionStatus.CANCELLED, jobId: null },
      });
    }
  }

  private hasScheduledMessage(leadId: string): Promise<boolean> {
    return this.prisma.liScheduledAction
      .count({ where: { leadId, type: LiScheduledActionType.SEND_MESSAGE, status: { not: LiScheduledActionStatus.CANCELLED } } })
      .then((n) => n > 0);
  }

  private async attachJob(scheduledActionId: string, type: LiScheduledActionType, leadId: string, stepOrder: number | undefined, runAt: Date) {
    if (!this.queue) return;
    const delay = Math.max(0, runAt.getTime() - Date.now());
    const data: LiJobData = { scheduledActionId, leadId, stepOrder };
    const job = await this.queue.add(TYPE_TO_JOB[type], data, {
      delay, removeOnComplete: 1000, removeOnFail: 5000, attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    });
    await this.prisma.liScheduledAction.update({
      where: { id: scheduledActionId },
      data: { status: LiScheduledActionStatus.QUEUED, jobId: job.id ?? null },
    });
  }

  // ── daily-cap helpers (per campaign) ─────────────────────────────────
  private startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  /**
   * Invites sent today across EVERY campaign on a seat.
   *
   * The per-campaign cap alone is not a safety limit: LinkedIn rate-limits the human
   * behind the account, not our campaign rows, so three campaigns on one seat used to
   * send three times the intended daily volume.
   */
  invitesSentTodayForAccount(accountRowId: string): Promise<number> {
    return this.prisma.liScheduledAction.count({
      where: {
        type: LiScheduledActionType.SEND_CONNECTION, status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: this.startOfToday() }, lead: { campaign: { linkedInAccountId: accountRowId } },
      },
    });
  }

  /** Messages sent today across every campaign on a seat (see invitesSentTodayForAccount). */
  messagesSentTodayForAccount(accountRowId: string): Promise<number> {
    return this.prisma.liScheduledAction.count({
      where: {
        type: LiScheduledActionType.SEND_MESSAGE, status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: this.startOfToday() }, lead: { campaign: { linkedInAccountId: accountRowId } },
      },
    });
  }

  invitesSentTodayForCampaign(campaignId: string): Promise<number> {
    return this.prisma.liScheduledAction.count({
      where: {
        type: LiScheduledActionType.SEND_CONNECTION, status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: this.startOfToday() }, lead: { campaignId },
      },
    });
  }

  messagesSentTodayForCampaign(campaignId: string): Promise<number> {
    return this.prisma.liScheduledAction.count({
      where: {
        type: LiScheduledActionType.SEND_MESSAGE, status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: this.startOfToday() }, lead: { campaignId },
      },
    });
  }

  /** When the campaign's most recent first-invite actually went out (today). Null = none yet. */
  async lastConnectionSentAt(campaignId: string): Promise<Date | null> {
    const last = await this.prisma.liScheduledAction.findFirst({
      where: {
        type: LiScheduledActionType.SEND_CONNECTION, status: LiScheduledActionStatus.DONE,
        updatedAt: { gte: this.startOfToday() }, lead: { campaignId },
      },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return last?.updatedAt ?? null;
  }

  /**
   * Target minimum spacing between consecutive first-invites: the send window divided by
   * the daily cap (the intended even pace), clamped to a sane floor/ceiling. This is the
   * send-time rate limiter that makes bursts impossible no matter how the queue was built
   * (retries, backfills, re-pulls, manual sends can all pile invites onto one instant).
   */
  minInviteSpacingMs(c: { run247: boolean; workStartHour: number; workEndHour: number; dailyConnectionLimit: number; warmupEnabled?: boolean; warmupStartedAt?: Date | null; warmupStartLimit?: number; warmupDays?: number }): number {
    const windowSecs = c.run247 ? 86_400 : Math.max(1, c.workEndHour - c.workStartHour) * 3600;
    const cap = Math.max(1, this.effectiveConnectionCap(c));
    const even = (windowSecs * 1000) / cap;
    const FLOOR = 3 * 60_000;   // never less than 3 min apart
    const CEIL = 90 * 60_000;   // never force more than 90 min apart
    return Math.min(CEIL, Math.max(FLOOR, even));
  }

  tomorrow(): Date { const d = this.startOfToday(); d.setDate(d.getDate() + 1); return d; }

  /**
   * A SCATTERED slot on the next working day's send window, for a DEFERRED invite (daily
   * cap reached / temporarily can't send). Critical: deferring to a fixed time (window
   * open) makes every deferred invite collapse to the SAME instant and fire as a burst
   * the next morning — a ban risk that also snowballs (the burst re-fills the next day
   * over cap). Randomising across the window keeps deferred invites spread out.
   */
  nextDeferralSlot(campaign: { run247: boolean; timezone: string; workStartHour: number; workEndHour: number; workDays: number[] }): Date {
    const windowSecs = campaign.run247 ? 86_400 : Math.max(1, campaign.workEndHour - campaign.workStartHour) * 3600;
    const winStart = this.nextAllowedSlot(campaign, this.tomorrow()); // next working day's window open
    return new Date(winStart.getTime() + Math.floor(Math.random() * windowSecs) * 1000);
  }

  /**
   * Warm-up-aware daily connection cap: ramps from warmupStartLimit up to
   * dailyConnectionLimit over warmupDays, so a (new) account isn't hit with full
   * volume on day one. Returns dailyConnectionLimit once warm-up is complete/off.
   */
  effectiveConnectionCap(c: {
    warmupEnabled?: boolean; warmupStartedAt?: Date | null; warmupStartLimit?: number;
    warmupDays?: number; dailyConnectionLimit: number;
  }, asOf: Date = new Date()): number {
    const target = c.dailyConnectionLimit;
    if (!c.warmupEnabled || !c.warmupStartedAt) return target;
    const days = Math.floor((asOf.getTime() - new Date(c.warmupStartedAt).getTime()) / 864e5);
    const rampDays = Math.max(1, c.warmupDays ?? 14);
    if (days >= rampDays) return target;
    const start = Math.min(c.warmupStartLimit ?? 5, target);
    const cap = Math.round(start + (target - start) * (days / rampDays));
    return Math.max(start, Math.min(target, cap));
  }

  // ── working-hours gating ─────────────────────────────────────────────
  private async gate(leadId: string, runAt: Date): Promise<Date> {
    const lead = await this.prisma.liLead.findUnique({
      where: { id: leadId },
      select: { campaign: { select: { run247: true, timezone: true, workStartHour: true, workEndHour: true, workDays: true } } },
    });
    if (!lead) return runAt;
    return this.nextAllowedSlot(lead.campaign, runAt);
  }

  private nextAllowedSlot(
    c: { run247: boolean; timezone: string; workStartHour: number; workEndHour: number; workDays: number[] },
    desired: Date,
  ): Date {
    if (c.run247) return desired;
    let d = new Date(desired);
    for (let i = 0; i < 14 * 24; i++) {
      const { hour, day } = this.localParts(d, c.timezone);
      if (c.workDays.includes(day) && hour >= c.workStartHour && hour < c.workEndHour) return d;
      d = new Date(d.getTime() + 60 * 60 * 1000);
    }
    return d;
  }

  private localParts(date: Date, tz: string): { hour: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit' }).formatToParts(date);
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hour = parseInt(hourStr, 10);
    if (Number.isNaN(hour) || hour === 24) hour = 0;
    return { hour, day: dayMap[wd] ?? 0 };
  }
}
