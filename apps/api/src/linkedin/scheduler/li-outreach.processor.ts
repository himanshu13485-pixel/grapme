import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  LiCampaignStatus, LiLeadStatus, LiMessageDirection, LiMessageSource,
  LiScheduledActionStatus, LiScheduledActionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_LINKEDIN } from '../../queue/queue.constants';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { LiSchedulerService } from './li-scheduler.service';
import { LiGenerationService } from '../campaigns/li-generation.service';
import {
  LiJob, LiJobData, FIRST_ACCEPTANCE_CHECK_MS, RECHECK_INTERVAL_MS,
  MAX_ACCEPTANCE_CHECKS, renderTemplate, pickVariant,
} from './li-queue.constants';

type LeadWithContext = NonNullable<Awaited<ReturnType<LiOutreachProcessor['loadContext']>>>;

@Processor(QUEUE_LINKEDIN)
export class LiOutreachProcessor extends WorkerHost {
  private readonly logger = new Logger(LiOutreachProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: LiSchedulerService,
    private readonly generation: LiGenerationService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {
    super();
  }

  async process(job: Job<LiJobData>): Promise<void> {
    // Repeatable drip tick — no scheduled action; refill campaign audiences.
    if (job.name === LiJob.DripSource) { await this.dripSweep(); return; }
    // Repeatable sync tick — re-sync acceptance + messages for running campaigns.
    if (job.name === LiJob.SyncSweep) { await this.scheduler.syncSweep(); return; }

    const { scheduledActionId } = job.data;
    const action = await this.prisma.liScheduledAction.findUnique({ where: { id: scheduledActionId } });
    if (!action || action.status === LiScheduledActionStatus.DONE || action.status === LiScheduledActionStatus.CANCELLED) return;

    await this.prisma.liScheduledAction.update({ where: { id: scheduledActionId }, data: { status: LiScheduledActionStatus.RUNNING } });

    const ctx = await this.loadContext(action.leadId);
    if (!ctx) return this.complete(scheduledActionId);
    if (ctx.campaign.status !== LiCampaignStatus.RUNNING) return this.cancel(scheduledActionId);
    // Halt outreach the moment a client is deactivated or its plan validity lapses,
    // even before the engine tick pauses the campaign. Defer, don't cancel — the
    // action is restored when the campaign resumes on reactivation.
    if (!(await this.clientCanSend(ctx.campaign.clientId))) return this.scheduler.rearm(scheduledActionId, this.scheduler.tomorrow());
    if (ctx.lead.status === LiLeadStatus.REPLIED || ctx.lead.status === LiLeadStatus.EXCLUDED || ctx.lead.status === LiLeadStatus.CAMPAIGN_COMPLETED) return this.complete(scheduledActionId);
    // Grace-window close needs no provider call — handle it before the account check so
    // a disconnected seat can't block marking finished leads as completed.
    if ((job.name as LiJob) === LiJob.CompleteLead) return this.doCompleteLead(scheduledActionId, ctx);
    if (!ctx.account.unipileAccountId) return this.fail(scheduledActionId, 'Account not connected to provider');

    try {
      switch (job.name as LiJob) {
        case LiJob.SendConnection: await this.doSendConnection(scheduledActionId, ctx); break;
        case LiJob.CheckAcceptance: await this.doCheckAcceptance(scheduledActionId, action.attempts, ctx); break;
        case LiJob.SendMessage: await this.doSendMessage(scheduledActionId, action.stepOrder ?? 0, ctx); break;
      }
    } catch (err) {
      const msg = (err as Error).message;
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
      await this.prisma.liScheduledAction.update({
        where: { id: scheduledActionId },
        data: { lastError: msg, status: willRetry ? LiScheduledActionStatus.QUEUED : LiScheduledActionStatus.FAILED },
      });
      if (willRetry) throw err;
      this.logger.error(`Action ${scheduledActionId} failed permanently: ${msg}`);
    }
  }

  private async doSendConnection(actionId: string, ctx: LeadWithContext) {
    const sentToday = await this.scheduler.invitesSentTodayForCampaign(ctx.campaign.id);
    const cap = this.scheduler.effectiveConnectionCap(ctx.campaign);
    if (sentToday >= cap) return this.scheduler.rearm(actionId, this.scheduler.tomorrow());

    const step1 = ctx.steps.find((s) => s.order === 1);
    const memberId = await this.ensureMemberId(ctx);
    const noteRaw = pickVariant(step1?.note, step1?.variants);
    const note = noteRaw ? renderTemplate(noteRaw, ctx.lead) : undefined;
    await this.provider.sendConnection({ accountId: ctx.account.unipileAccountId!, memberId, note });

    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: { status: LiLeadStatus.CONNECTION_PENDING, currentStep: 1, lastActionAt: new Date() },
    });
    await this.complete(actionId);
    await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.CHECK_ACCEPTANCE, undefined, new Date(Date.now() + FIRST_ACCEPTANCE_CHECK_MS));
  }

  private async doCheckAcceptance(actionId: string, attempts: number, ctx: LeadWithContext) {
    if (ctx.lead.status !== LiLeadStatus.CONNECTION_PENDING) return this.complete(actionId);
    const accepted = await this.provider.isConnectionAccepted({ accountId: ctx.account.unipileAccountId!, memberId: ctx.lead.unipileMemberId! });
    if (!accepted) {
      if (attempts >= MAX_ACCEPTANCE_CHECKS) return this.complete(actionId);
      return this.scheduler.rearm(actionId, new Date(Date.now() + RECHECK_INTERVAL_MS));
    }
    await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.CONNECTED, connectedAt: new Date(), currentStep: 1 } });
    await this.complete(actionId);
    await this.scheduleNextMessage(ctx, 1);
  }

  private async doSendMessage(actionId: string, stepOrder: number, ctx: LeadWithContext) {
    const sentToday = await this.scheduler.messagesSentTodayForCampaign(ctx.campaign.id);
    if (sentToday >= ctx.campaign.dailyMessageLimit) return this.scheduler.rearm(actionId, this.scheduler.tomorrow());

    const step = ctx.steps.find((s) => s.order === stepOrder);
    if (!step) return this.complete(actionId);
    const bodyRaw = pickVariant(step.body, step.variants);
    if (!bodyRaw) return this.complete(actionId);

    const memberId = await this.ensureMemberId(ctx);
    const text = renderTemplate(bodyRaw, ctx.lead);
    const res = await this.provider.sendMessage({ accountId: ctx.account.unipileAccountId!, memberId, text });

    const conversation = await this.prisma.liConversation.upsert({
      where: { leadId: ctx.lead.id },
      create: { leadId: ctx.lead.id, unipileChatId: res.chatId || null },
      update: { unipileChatId: res.chatId || undefined },
    });
    await this.prisma.liMessage.create({
      data: { conversationId: conversation.id, direction: LiMessageDirection.OUTBOUND, source: LiMessageSource.AUTO, body: text, unipileMessageId: res.messageId || null },
    });
    await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.MESSAGED, currentStep: stepOrder, lastActionAt: new Date() } });
    await this.complete(actionId);
    await this.scheduleNextMessage(ctx, stepOrder);
  }

  private async scheduleNextMessage(ctx: LeadWithContext, afterOrder: number) {
    const assigned = await this.resolveAssignedMessages(ctx);
    const messageSteps = ctx.steps.filter((s) => s.type === 'MESSAGE');
    const next = ctx.steps.find((s) => s.order === afterOrder + 1 && s.type === 'MESSAGE');
    if (next) {
      // 1-based position of `next` among MESSAGE steps = its follow-up number. Only send
      // it if it's within this lead's randomly-assigned message count.
      const idx = messageSteps.findIndex((s) => s.order === next.order) + 1;
      if (idx <= assigned) {
        await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.SEND_MESSAGE, next.order, new Date(Date.now() + next.waitHours * 60 * 60 * 1000));
        return;
      }
    }
    // No further messages for this lead → open the grace window, then mark completed.
    const graceMs = Math.max(0, ctx.campaign.graceHours ?? 96) * 60 * 60 * 1000;
    await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.COMPLETE_LEAD, undefined, new Date(Date.now() + graceMs));
  }

  /**
   * Draw (once, then persist) how many MESSAGE steps THIS lead receives, from the
   * campaign's [followUpMin, followUpMax]. 0/0 (feature off) → all configured steps.
   * Clamped to the number of steps that actually exist.
   */
  private async resolveAssignedMessages(ctx: LeadWithContext): Promise<number> {
    if (ctx.lead.assignedMessages != null) return ctx.lead.assignedMessages;
    const total = ctx.steps.filter((s) => s.type === 'MESSAGE').length;
    const min = ctx.campaign.followUpMin ?? 0;
    const max = ctx.campaign.followUpMax ?? 0;
    let assigned = total;
    if (min > 0 && max >= min) {
      const lo = Math.min(min, total);
      const hi = Math.min(max, total);
      assigned = hi <= lo ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
    }
    await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { assignedMessages: assigned } });
    ctx.lead.assignedMessages = assigned;
    return assigned;
  }

  /** Grace window elapsed: if the lead never replied, mark it CAMPAIGN_COMPLETED. */
  private async doCompleteLead(actionId: string, ctx: LeadWithContext) {
    if (ctx.lead.status === LiLeadStatus.CONNECTED || ctx.lead.status === LiLeadStatus.MESSAGED) {
      await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.CAMPAIGN_COMPLETED } });
    }
    await this.complete(actionId);
  }

  private async ensureMemberId(ctx: LeadWithContext): Promise<string> {
    if (ctx.lead.unipileMemberId) return ctx.lead.unipileMemberId;
    if (!ctx.lead.profileUrl) throw new Error('Lead has no profileUrl to resolve');
    const member = await this.provider.resolveMember(ctx.account.unipileAccountId!, ctx.lead.profileUrl);
    // Prefer LinkedIn's real name over the URL-slug placeholder created at import
    // (e.g. "Sachdevahimanshu" → "Himanshu Sachdeva"). Keep an explicitly-typed name.
    const looksLikeSlug = !ctx.lead.fullName || !/\s/.test(ctx.lead.fullName);
    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: {
        unipileMemberId: member.memberId,
        fullName: looksLikeSlug && member.fullName ? member.fullName : ctx.lead.fullName,
        firstName: ctx.lead.firstName ?? member.firstName,
        lastName: ctx.lead.lastName ?? member.lastName,
        title: ctx.lead.title ?? member.title,
        company: ctx.lead.company ?? member.company,
        location: ctx.lead.location ?? member.location,
        avatarUrl: ctx.lead.avatarUrl ?? member.avatarUrl,
      },
    });
    ctx.lead.unipileMemberId = member.memberId;
    return member.memberId;
  }

  /** Drip-sourcer: top up each RUNNING drip campaign's PENDING list to its buffer, once/day. */
  private async dripSweep() {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const campaigns = await this.prisma.liCampaign.findMany({
      where: { status: LiCampaignStatus.RUNNING, dripEnabled: true },
      select: { id: true, dripDailyTarget: true, dripBuffer: true, lastDripAt: true },
    });
    for (const c of campaigns) {
      try {
        if (c.lastDripAt && c.lastDripAt >= startOfDay) continue; // already dripped today
        const pending = await this.prisma.liLead.count({ where: { campaignId: c.id, status: LiLeadStatus.PENDING } });
        const need = Math.min(c.dripDailyTarget, c.dripBuffer - pending);
        if (need <= 0) continue; // buffer already full
        const res = await this.generation.sourceLeads(c.id, need);
        if (res.sourced > 0) {
          await this.prisma.liCampaign.update({ where: { id: c.id }, data: { lastDripAt: new Date() } });
          // Enqueue the first action for the freshly-sourced PENDING leads.
          await this.scheduler.startCampaign(c.id);
          this.logger.log(`Drip sourced ${res.sourced} lead(s) for campaign ${c.id}`);
        }
      } catch (e) {
        this.logger.warn(`Drip skipped for campaign ${c.id}: ${(e as Error).message}`);
      }
    }
  }

  /** A client sends only while it's active AND its plan validity window hasn't lapsed. */
  private async clientCanSend(clientId: string): Promise<boolean> {
    const c = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { status: true, validityDays: true, validityStartAt: true },
    });
    if (!c || c.status !== 'active') return false;
    if (c.validityDays && c.validityStartAt) {
      const expiry = c.validityStartAt.getTime() + c.validityDays * 86_400_000;
      if (expiry < Date.now()) return false;
    }
    return true;
  }

  async loadContext(leadId: string) {
    const lead = await this.prisma.liLead.findUnique({
      where: { id: leadId },
      include: { campaign: { include: { steps: { orderBy: { order: 'asc' } }, linkedInAccount: true } } },
    });
    if (!lead) return null;
    return { lead, campaign: lead.campaign, steps: lead.campaign.steps, account: lead.campaign.linkedInAccount };
  }

  private complete(actionId: string) {
    return this.prisma.liScheduledAction.update({ where: { id: actionId }, data: { status: LiScheduledActionStatus.DONE } }).then(() => undefined);
  }
  private cancel(actionId: string) {
    return this.prisma.liScheduledAction.update({ where: { id: actionId }, data: { status: LiScheduledActionStatus.CANCELLED } }).then(() => undefined);
  }
  private fail(actionId: string, error: string) {
    return this.prisma.liScheduledAction.update({ where: { id: actionId }, data: { status: LiScheduledActionStatus.FAILED, lastError: error } }).then(() => undefined);
  }
}
