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
import {
  LiJob, LiJobData, FIRST_ACCEPTANCE_CHECK_MS, RECHECK_INTERVAL_MS,
  MAX_ACCEPTANCE_CHECKS, renderTemplate,
} from './li-queue.constants';

type LeadWithContext = NonNullable<Awaited<ReturnType<LiOutreachProcessor['loadContext']>>>;

@Processor(QUEUE_LINKEDIN)
export class LiOutreachProcessor extends WorkerHost {
  private readonly logger = new Logger(LiOutreachProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: LiSchedulerService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {
    super();
  }

  async process(job: Job<LiJobData>): Promise<void> {
    const { scheduledActionId } = job.data;
    const action = await this.prisma.liScheduledAction.findUnique({ where: { id: scheduledActionId } });
    if (!action || action.status === LiScheduledActionStatus.DONE || action.status === LiScheduledActionStatus.CANCELLED) return;

    await this.prisma.liScheduledAction.update({ where: { id: scheduledActionId }, data: { status: LiScheduledActionStatus.RUNNING } });

    const ctx = await this.loadContext(action.leadId);
    if (!ctx) return this.complete(scheduledActionId);
    if (ctx.campaign.status !== LiCampaignStatus.RUNNING) return this.cancel(scheduledActionId);
    if (ctx.lead.status === LiLeadStatus.REPLIED || ctx.lead.status === LiLeadStatus.EXCLUDED) return this.complete(scheduledActionId);
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
    if (sentToday >= ctx.campaign.dailyConnectionLimit) return this.scheduler.rearm(actionId, this.scheduler.tomorrow());

    const step1 = ctx.steps.find((s) => s.order === 1);
    const memberId = await this.ensureMemberId(ctx);
    const note = step1?.note ? renderTemplate(step1.note, ctx.lead) : undefined;
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
    if (!step || !step.body) return this.complete(actionId);

    const memberId = await this.ensureMemberId(ctx);
    const text = renderTemplate(step.body, ctx.lead);
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
    const next = ctx.steps.find((s) => s.order === afterOrder + 1);
    if (!next || next.type !== 'MESSAGE') return;
    await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.SEND_MESSAGE, next.order, new Date(Date.now() + next.waitHours * 60 * 60 * 1000));
  }

  private async ensureMemberId(ctx: LeadWithContext): Promise<string> {
    if (ctx.lead.unipileMemberId) return ctx.lead.unipileMemberId;
    if (!ctx.lead.profileUrl) throw new Error('Lead has no profileUrl to resolve');
    const member = await this.provider.resolveMember(ctx.account.unipileAccountId!, ctx.lead.profileUrl);
    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: {
        unipileMemberId: member.memberId,
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
