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
  MAX_ACCEPTANCE_CHECKS, renderTemplate, pickVariant, reconcileName,
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
    // NOT_ACCEPTED is terminal: the invite was given up on and withdrawn, so the lead
    // is out of the sequence — no further follow-ups (the "not yet accepted" branch
    // only applies while the invite is still pending).
    if (
      ctx.lead.status === LiLeadStatus.REPLIED ||
      ctx.lead.status === LiLeadStatus.EXCLUDED ||
      ctx.lead.status === LiLeadStatus.CAMPAIGN_COMPLETED ||
      ctx.lead.status === LiLeadStatus.NOT_ACCEPTED
    ) return this.complete(scheduledActionId);
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
    const { invitationId } = await this.provider.sendConnection({ accountId: ctx.account.unipileAccountId!, memberId, note });

    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: {
        status: LiLeadStatus.CONNECTION_PENDING, currentStep: 1, lastActionAt: new Date(),
        unipileInvitationId: invitationId || undefined, // stored so we can withdraw if never accepted
      },
    });
    await this.complete(actionId);
    await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.CHECK_ACCEPTANCE, undefined, new Date(Date.now() + FIRST_ACCEPTANCE_CHECK_MS));
    // Follow-ups run on their own clock from the invite ("N hours after the previous
    // step"), so an "Always" step lands on time whether or not the invite was
    // accepted. Acceptance polling continues in parallel and each step re-checks the
    // branch when it fires.
    if (ctx.steps.some((s) => s.type === 'MESSAGE')) await this.scheduleNextMessage(ctx, 1);
  }

  private async doCheckAcceptance(actionId: string, attempts: number, ctx: LeadWithContext) {
    if (ctx.lead.status !== LiLeadStatus.CONNECTION_PENDING) return this.complete(actionId);
    const accepted = await this.provider.isConnectionAccepted({ accountId: ctx.account.unipileAccountId!, memberId: ctx.lead.unipileMemberId! });
    if (!accepted) {
      // Give up once the acceptance window has elapsed (or the hard safety cap): the
      // invite was declined/ignored — withdraw it and mark the lead NOT_ACCEPTED.
      const windowMs = Math.max(1, ctx.campaign.connectionWindowDays ?? 5) * 24 * 60 * 60 * 1000;
      const sentAt = ctx.lead.lastActionAt?.getTime() ?? Date.now();
      if (Date.now() - sentAt >= windowMs || attempts >= MAX_ACCEPTANCE_CHECKS) {
        if (ctx.lead.unipileInvitationId) {
          await this.provider
            .withdrawConnection({ accountId: ctx.account.unipileAccountId!, invitationId: ctx.lead.unipileInvitationId })
            .catch((e) => this.logger.warn(`Withdraw invite for lead ${ctx.lead.id} failed: ${(e as Error).message}`));
        }
        // The follow-up timeline (incl. any "if NOT accepted" branch) is already
        // running from the invite, so nothing to schedule here.
        await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.NOT_ACCEPTED } });
        return this.complete(actionId);
      }
      return this.scheduler.rearm(actionId, new Date(Date.now() + RECHECK_INTERVAL_MS));
    }
    await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.CONNECTED, connectedAt: new Date(), currentStep: 1 } });
    await this.complete(actionId);
    // Follow-ups are already queued from the invite. Only close the lead out here
    // when the sequence has no follow-up messages at all.
    if (!ctx.steps.some((s) => s.type === 'MESSAGE')) await this.scheduleNextMessage(ctx, 1);
  }

  private async doSendMessage(actionId: string, stepOrder: number, ctx: LeadWithContext) {
    const sentToday = await this.scheduler.messagesSentTodayForCampaign(ctx.campaign.id);
    if (sentToday >= ctx.campaign.dailyMessageLimit) return this.scheduler.rearm(actionId, this.scheduler.tomorrow());

    const step = ctx.steps.find((s) => s.order === stepOrder);
    if (!step) return this.complete(actionId);

    // Accept branch, judged right now: e.g. "only if accepted" is skipped when the
    // invite is still unaccepted, and the sequence moves straight to the next step
    // (which may be the "only if NOT accepted" alternative).
    let accepted = !!ctx.lead.connectedAt;
    // Still waiting on the invite? Check live rather than trusting the last poll —
    // otherwise a short wait (or a manual "Send next") could take the wrong branch
    // just because the 3-hourly acceptance check hadn't run yet.
    if (
      !accepted &&
      (step.condition ?? 'ANY') !== 'ANY' &&
      ctx.lead.status === LiLeadStatus.CONNECTION_PENDING &&
      ctx.lead.unipileMemberId
    ) {
      try {
        accepted = await this.provider.isConnectionAccepted({
          accountId: ctx.account.unipileAccountId!,
          memberId: ctx.lead.unipileMemberId,
        });
        if (accepted) {
          await this.prisma.liLead.update({
            where: { id: ctx.lead.id },
            data: { status: LiLeadStatus.CONNECTED, connectedAt: new Date() },
          });
        }
      } catch (err) {
        this.logger.warn(`Live acceptance check failed for lead ${ctx.lead.id}: ${(err as Error).message}`);
      }
    }
    if (!stepAllowed(step.condition, accepted)) {
      await this.complete(actionId);
      await this.scheduleNextMessage(ctx, stepOrder);
      return;
    }

    const bodyRaw = pickVariant(step.body, step.variants);
    if (!bodyRaw) return this.complete(actionId);

    const memberId = await this.ensureMemberId(ctx);
    const text = renderTemplate(bodyRaw, ctx.lead);
    let res: Awaited<ReturnType<typeof this.provider.sendMessage>>;
    try {
      res = await this.provider.sendMessage({ accountId: ctx.account.unipileAccountId!, memberId, text });
    } catch (err) {
      // e.g. LinkedIn refuses a DM to someone who isn't a connection (the
      // IF_NOT_ACCEPTED branch). Don't loop — log, skip this step, move on.
      this.logger.warn(`LI message send failed for lead ${ctx.lead.id} (step ${stepOrder}): ${(err as Error).message}`);
      await this.complete(actionId);
      await this.scheduleNextMessage(ctx, stepOrder);
      return;
    }

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

  /**
   * Queue the next MESSAGE step on the timeline. Steps are scheduled purely by order
   * + waitHours ("N hours after the previous step"); whether a step actually sends is
   * decided when it fires (see doSendMessage), so a lead accepting late still gets
   * the right branch.
   */
  private async scheduleNextMessage(ctx: LeadWithContext, afterOrder: number) {
    const assigned = await this.resolveAssignedMessages(ctx);
    const messageSteps = ctx.steps.filter((s) => s.type === 'MESSAGE');
    const next = messageSteps.find((s) => s.order > afterOrder);
    if (next) {
      // 1-based position among MESSAGE steps = its follow-up number. Only queue it if
      // it's within this lead's randomly-assigned message count.
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
    // Replace any URL-slug placeholder name (full AND first/last, used in {first_name}
    // tokens) with the real profile name — "sachdevahimanshu" → "Himanshu Sachdeva".
    const name = reconcileName(ctx.lead, member);
    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: {
        unipileMemberId: member.memberId,
        fullName: name.fullName || ctx.lead.fullName,
        firstName: name.firstName,
        lastName: name.lastName,
        title: ctx.lead.title ?? member.title,
        company: ctx.lead.company ?? member.company,
        location: ctx.lead.location ?? member.location,
        avatarUrl: ctx.lead.avatarUrl ?? member.avatarUrl,
      },
    });
    ctx.lead.unipileMemberId = member.memberId;
    ctx.lead.firstName = name.firstName ?? ctx.lead.firstName;
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

/**
 * Whether a MESSAGE step should fire, evaluated at send time. Only two live states
 * reach here — ACCEPTED (`accepted`) and still-PENDING (`!accepted`); a rejected /
 * given-up invite (NOT_ACCEPTED) is terminal and short-circuits earlier in
 * `process()`, so no further follow-ups go out once the invite is withdrawn.
 *
 *   ANY             → always, accepted or still pending (runs on its own schedule)
 *   IF_ACCEPTED     → only once the invite has been accepted
 *   IF_NOT_ACCEPTED → only while the invite is NOT YET accepted (pending)
 *
 * (LinkedIn only reliably delivers DMs to accepted connections; a refused send is
 * logged and the sequence moves on.)
 */
function stepAllowed(condition: string | null | undefined, accepted: boolean): boolean {
  switch (condition ?? 'ANY') {
    case 'IF_NOT_ACCEPTED':
      return !accepted;
    case 'IF_ACCEPTED':
      return accepted;
    default: // ANY — always, whether or not the invite was accepted
      return true;
  }
}
