import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  LiCampaignStatus, LiLeadStatus, LiScheduledActionStatus, LiScheduledActionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_LINKEDIN } from '../../queue/queue.constants';
import { LiJob, LiJobData, DRIP_SCAN_MS } from './li-queue.constants';

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
    // Optional so the platform boots without Redis (scheduler no-ops when absent).
    @Optional() @InjectQueue(QUEUE_LINKEDIN) private readonly queue?: Queue,
  ) {}

  /** Register the repeatable drip-sourcer tick (no-op without Redis). */
  async onModuleInit() {
    if (!this.queue) return;
    await this.queue.add(LiJob.DripSource, {}, { repeat: { every: DRIP_SCAN_MS }, removeOnComplete: true, removeOnFail: true });
    this.logger.log(`LinkedIn drip-sourcer registered (every ${DRIP_SCAN_MS}ms)`);
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
    if (campaign.linkedInAccount.status !== 'CONNECTED') {
      this.logger.warn(`Campaign ${campaignId} account not connected; cannot run`);
      return;
    }

    // Re-attach any orphaned pending actions (resume case).
    const pending = await this.prisma.liScheduledAction.findMany({
      where: {
        status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] },
        lead: { campaignId },
      },
    });
    for (const a of pending) {
      await this.attachJob(a.id, a.type, a.leadId, a.stepOrder ?? undefined, a.runAt);
    }

    // Enqueue the first action per fresh lead, paced by the daily limit (warm-up aware).
    const direct = campaign.outreachType === 'DIRECT_MESSAGES';
    const freshLeads = await this.prisma.liLead.findMany({
      where: { campaignId, status: LiLeadStatus.PENDING, scheduled: { none: {} } },
      select: { id: true },
    });
    const limit = Math.max(1, direct ? campaign.dailyMessageLimit : this.effectiveConnectionCap(campaign));
    // Spread the daily cap EVENLY across the send window (not a burst), with a small
    // ± random wobble per slot for a human feel. E.g. 20/day over a 9h window ≈ one
    // action every ~27 min. Actions past the window roll to the next day's window.
    const windowSecs = campaign.run247 ? 86_400 : Math.max(1, campaign.workEndHour - campaign.workStartHour) * 3600;
    const baseSpacing = windowSecs / limit; // seconds between consecutive sends
    const jMin = Math.max(0, campaign.jitterMinSeconds ?? 20);
    const jMax = Math.max(jMin, campaign.jitterMaxSeconds ?? 90);
    const wobble = () => (jMin + Math.random() * (jMax - jMin)) * (Math.random() < 0.5 ? -1 : 1);
    let index = 0;
    for (const lead of freshLeads) {
      const day = Math.floor(index / limit);
      const slot = index % limit;
      // Anchor each day to the START of its send window; never schedule in the past.
      const winStart = this.nextAllowedSlot(campaign, new Date(this.startOfToday().getTime() + day * 864e5));
      const anchor = day === 0 ? Math.max(winStart.getTime(), Date.now()) : winStart.getTime();
      const runAt = new Date(anchor + Math.max(0, slot * baseSpacing + wobble()) * 1000);
      if (direct) await this.schedule(lead.id, LiScheduledActionType.SEND_MESSAGE, 1, runAt);
      else await this.schedule(lead.id, LiScheduledActionType.SEND_CONNECTION, undefined, runAt);
      index++;
    }
    this.logger.log(`Campaign ${campaignId} (${campaign.outreachType}): resumed ${pending.length}, queued ${freshLeads.length}`);
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

  tomorrow(): Date { const d = this.startOfToday(); d.setDate(d.getDate() + 1); return d; }

  /**
   * Warm-up-aware daily connection cap: ramps from warmupStartLimit up to
   * dailyConnectionLimit over warmupDays, so a (new) account isn't hit with full
   * volume on day one. Returns dailyConnectionLimit once warm-up is complete/off.
   */
  effectiveConnectionCap(c: {
    warmupEnabled?: boolean; warmupStartedAt?: Date | null; warmupStartLimit?: number;
    warmupDays?: number; dailyConnectionLimit: number;
  }): number {
    const target = c.dailyConnectionLimit;
    if (!c.warmupEnabled || !c.warmupStartedAt) return target;
    const days = Math.floor((Date.now() - new Date(c.warmupStartedAt).getTime()) / 864e5);
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
