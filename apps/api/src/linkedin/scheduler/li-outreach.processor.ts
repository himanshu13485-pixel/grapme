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
import { ProfileBudgetExceededError } from '../provider/li-rate-guard.service';
import { LiGenerationService } from '../campaigns/li-generation.service';
import { LinkedInAccountsService } from '../accounts/linkedin-accounts.service';
import { linkConversation } from '../link-conversation';
import {
  LiJob, LiJobData, renderTemplate, pickVariant, reconcileName,
} from './li-queue.constants';

type LoadedContext = NonNullable<Awaited<ReturnType<LiOutreachProcessor['loadContext']>>>;
/** A context whose campaign still has an account — everything that talks to LinkedIn needs one. */
type LeadWithContext = LoadedContext & { account: NonNullable<LoadedContext['account']> };

@Processor(QUEUE_LINKEDIN)
export class LiOutreachProcessor extends WorkerHost {
  private readonly logger = new Logger(LiOutreachProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: LiSchedulerService,
    private readonly generation: LiGenerationService,
    private readonly accounts: LinkedInAccountsService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {
    super();
  }

  async process(job: Job<LiJobData>): Promise<void> {
    // Repeatable drip tick — no scheduled action; refill campaign audiences.
    if (job.name === LiJob.DripSource) { await this.dripSweep(); await this.scheduler.scheduleSweep(); return; }
    // Repeatable sync tick — re-sync acceptance + messages for running campaigns.
    if (job.name === LiJob.SyncSweep) { await this.scheduler.syncSweep(); return; }

    const { scheduledActionId } = job.data;
    const action = await this.prisma.liScheduledAction.findUnique({ where: { id: scheduledActionId } });
    if (!action || action.status === LiScheduledActionStatus.DONE || action.status === LiScheduledActionStatus.CANCELLED) return;

    await this.prisma.liScheduledAction.update({ where: { id: scheduledActionId }, data: { status: LiScheduledActionStatus.RUNNING } });

    const loaded = await this.loadContext(action.leadId);
    if (!loaded) return this.complete(scheduledActionId);
    if (loaded.campaign.status !== LiCampaignStatus.RUNNING) return this.cancel(scheduledActionId);
    // Halt outreach the moment a client is deactivated or its plan validity lapses,
    // even before the engine tick pauses the campaign. Defer, don't cancel — the
    // action is restored when the campaign resumes on reactivation.
    if (!(await this.clientCanSend(loaded.campaign.clientId))) return this.scheduler.rearm(scheduledActionId, this.scheduler.nextDeferralSlot(loaded.campaign));
    // NOT_ACCEPTED is terminal: the invite was given up on and withdrawn, so the lead
    // is out of the sequence — no further follow-ups (the "not yet accepted" branch
    // only applies while the invite is still pending).
    if (
      loaded.lead.status === LiLeadStatus.REPLIED ||
      loaded.lead.status === LiLeadStatus.EXCLUDED ||
      loaded.lead.status === LiLeadStatus.CAMPAIGN_COMPLETED ||
      loaded.lead.status === LiLeadStatus.NOT_ACCEPTED
    ) return this.complete(scheduledActionId);
    // Grace-window close needs no provider call — handle it before the account check so
    // a disconnected (or removed) seat can't block marking finished leads as completed.
    if ((job.name as LiJob) === LiJob.CompleteLead) return this.doCompleteLead(scheduledActionId, loaded);
    // The campaign's account was removed. Defer rather than fail: the lead keeps its
    // place, and the action runs once a new account is attached and the campaign resumes.
    if (!loaded.account) return this.scheduler.rearm(scheduledActionId, this.scheduler.nextDeferralSlot(loaded.campaign));
    const ctx: LeadWithContext = { ...loaded, account: loaded.account };
    if (!ctx.account.unipileAccountId) return this.fail(scheduledActionId, 'Account not connected to provider');

    try {
      switch (job.name as LiJob) {
        case LiJob.SendConnection: await this.doSendConnection(scheduledActionId, ctx); break;
        case LiJob.CheckAcceptance: await this.doCheckAcceptance(scheduledActionId, action.attempts, ctx); break;
        case LiJob.SendMessage: await this.doSendMessage(scheduledActionId, action.stepOrder ?? 0, ctx); break;
      }
    } catch (err) {
      const msg = ((err as Error)?.message || String(err) || '').trim() || 'Send failed (no detail returned by LinkedIn)';
      // Seat spent its daily profile-read budget. That's a pacing limit, not a fault:
      // defer to the next working slot so the lead keeps its place in the sequence.
      if (err instanceof ProfileBudgetExceededError) {
        await this.prisma.liScheduledAction.update({
          where: { id: scheduledActionId },
          data: { lastError: 'Deferred — daily profile-read budget reached' },
        });
        return this.scheduler.rearm(scheduledActionId, this.scheduler.nextDeferralSlot(ctx.campaign));
      }
      // Account-level failure (checkpoint / re-auth needed / disconnected / rate-limited):
      // it's the SEAT, not the lead. Flag the account for re-auth and DEFER this action to
      // the next working day instead of burning the lead as Failed — so a whole campaign
      // doesn't get wiped out when the LinkedIn account trips a security checkpoint.
      if (isAccountDown(msg) && ctx.account) {
        await this.flagAccountNeedsAuth(ctx.account, msg);
        await this.prisma.liScheduledAction.update({ where: { id: scheduledActionId }, data: { lastError: `Account needs attention — ${msg}` } });
        return this.scheduler.rearm(scheduledActionId, this.scheduler.nextDeferralSlot(ctx.campaign));
      }
      // Permanent per-lead failure on a connection request (profile can't be resolved —
      // bad/expired/corrupted URL). Don't retry forever: exclude the lead + backfill.
      if ((job.name as LiJob) === LiJob.SendConnection && isUnresolvableLead(msg)) {
        await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.EXCLUDED } }).catch(() => undefined);
        await this.prisma.liScheduledAction.update({ where: { id: scheduledActionId }, data: { status: LiScheduledActionStatus.CANCELLED, lastError: `Excluded — unresolvable profile: ${msg}`.slice(0, 240) } });
        await this.scheduler.claimNextConnection(ctx.campaign.id);
        this.logger.warn(`Lead ${ctx.lead.id} excluded (unresolvable profile): ${msg}`);
        return;
      }
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
      await this.prisma.liScheduledAction.update({
        where: { id: scheduledActionId },
        data: { lastError: msg, status: willRetry ? LiScheduledActionStatus.QUEUED : LiScheduledActionStatus.FAILED },
      });
      if (willRetry) throw err;
      this.logger.error(`Action ${scheduledActionId} failed permanently: ${msg}`);
    }
  }

  /**
   * Flip a LinkedIn seat to "needs re-auth" (once) when it trips a checkpoint/disconnect,
   * and stop every campaign running on it.
   *
   * Flagging alone wasn't enough: the seat's other campaigns kept firing into an account
   * LinkedIn had already checkpointed, which is how a warning becomes a restriction.
   */
  private async flagAccountNeedsAuth(account: { id: string; status: string }, reason: string) {
    if (account.status === 'CREDENTIALS' || account.status === 'DISCONNECTED') return; // already flagged
    await this.prisma.linkedInAccount.update({
      where: { id: account.id },
      data: { status: 'CREDENTIALS', pausedReason: reason.slice(0, 240), pausedAt: new Date() },
    }).catch(() => undefined);
    this.logger.warn(`LinkedIn account ${account.id} flagged for re-auth: ${reason}`);
    await this.accounts.pauseSeatCampaigns(account.id, reason).catch((e) =>
      this.logger.error(`Circuit breaker failed for seat ${account.id}: ${(e as Error).message}`),
    );
    // Flagging happens once per outage (this returns early if already flagged), so the
    // admins get one alert per incident rather than one per failed send.
    await this.accounts.alertSeatStopped(account.id, `LinkedIn stopped the account: ${reason}`);
  }

  private async doSendConnection(actionId: string, ctx: LeadWithContext) {
    // Corrupted profile link: a LinkedIn member-id slug (ACxAA…) that was lowercased by
    // the old normalizer can never be resolved. Don't waste a send slot or clog the log —
    // exclude the lead with a clear reason and backfill a fresh one so the campaign moves on.
    if (!ctx.lead.unipileMemberId && isCorruptedMemberIdUrl(ctx.lead.profileUrl)) {
      await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.EXCLUDED } });
      await this.prisma.liScheduledAction.update({ where: { id: actionId }, data: { status: LiScheduledActionStatus.CANCELLED, lastError: 'Excluded — corrupted profile link (re-import this lead)' } });
      await this.scheduler.claimNextConnection(ctx.campaign.id);
      this.logger.warn(`Lead ${ctx.lead.id} excluded — corrupted member-id URL: ${ctx.lead.profileUrl}`);
      return;
    }

    const sentToday = await this.scheduler.invitesSentTodayForCampaign(ctx.campaign.id);
    const cap = this.scheduler.effectiveConnectionCap(ctx.campaign);
    if (sentToday >= cap) return this.scheduler.rearm(actionId, this.scheduler.nextDeferralSlot(ctx.campaign));

    // Seat-level ceiling on top of the campaign cap. LinkedIn limits the person, not the
    // campaign, so several campaigns sharing a seat must share one daily budget.
    const seatSentToday = await this.scheduler.invitesSentTodayForAccount(ctx.account.id);
    if (seatSentToday >= ctx.account.dailyInviteLimit) {
      this.logger.warn(`Seat ${ctx.account.id} hit its daily invite ceiling (${ctx.account.dailyInviteLimit}) — deferring`);
      return this.scheduler.rearm(actionId, this.scheduler.nextDeferralSlot(ctx.campaign));
    }

    // Send-time spacing guard: if the last invite went out too recently, defer this one so
    // invites never fire as a burst — even when the queue got piled onto one instant by
    // retries/backfills/re-pulls. rearm() re-gates to working hours.
    const minGap = this.scheduler.minInviteSpacingMs(ctx.campaign);
    const lastAt = await this.scheduler.lastConnectionSentAt(ctx.campaign.id);
    if (lastAt && Date.now() - lastAt.getTime() < minGap) {
      const jitter = Math.floor(Math.random() * 60_000);
      return this.scheduler.rearm(actionId, new Date(lastAt.getTime() + minGap + jitter));
    }

    const step1 = ctx.steps.find((s) => s.order === 1);
    const memberId = await this.ensureMemberId(ctx);
    // Lead-quality gate: skip profiles below the campaign's minimum connection count.
    // ensureMemberId just fetched the profile, so the count is free. Unknown/hidden
    // counts pass. Cancel (not complete) the action so a skipped lead doesn't burn one
    // of today's invite slots — the daily cap counts DONE invites only.
    const minConn = ctx.campaign.minConnections ?? 0;
    const maxConn = ctx.campaign.maxConnections ?? 0;
    const count = ctx.lead.connectionsCount;
    const belowMin = minConn > 0 && count != null && count < minConn;
    // People at/near LinkedIn's 30k cap can't accept invites → the send fails, so skip them.
    const aboveMax = maxConn > 0 && count != null && count > maxConn;
    if (belowMin || aboveMax) {
      const reason = belowMin
        ? `Excluded: ${count} connections (min ${minConn})`
        : `Excluded: ${count} connections (max ${maxConn})`;
      await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.EXCLUDED } });
      // Record the reason on the (cancelled) action so it surfaces in the activity log.
      await this.prisma.liScheduledAction.update({ where: { id: actionId }, data: { status: LiScheduledActionStatus.CANCELLED, lastError: reason } });
      this.logger.log(`Lead ${ctx.lead.id} ${reason}`);
      // Backfill the freed slot from the pending bucket so the day still hits the eligible
      // cap. The substitute is a normal action that itself backfills if it too is
      // ineligible — chaining through the bucket until an eligible lead sends or it runs
      // dry (the daily cap still hard-limits actual sends).
      await this.scheduler.claimNextConnection(ctx.campaign.id);
      return;
    }
    const noteRaw = pickVariant(step1?.note, step1?.variants);
    const note = noteRaw ? renderTemplate(noteRaw, ctx.lead) : undefined;
    let invitationId = '';
    try {
      ({ invitationId } = await this.provider.sendConnection({ accountId: ctx.account.unipileAccountId!, memberId, note }));
    } catch (err) {
      // "cannot_resend_yet" / "already invited" means an invitation to this person is ALREADY
      // pending (a duplicate action tried to re-send it) — LinkedIn blocks re-inviting within
      // its cooldown. That's not a real failure: advance the lead to CONNECTION_PENDING and
      // wait for acceptance, so it stops looping as "Failed" and never gets re-pulled. Any
      // other error falls through to normal retry/fail handling.
      if (isAlreadyInvited(err)) {
        await this.prisma.liLead.update({
          where: { id: ctx.lead.id },
          data: { status: LiLeadStatus.CONNECTION_PENDING, currentStep: 1, lastActionAt: new Date() },
        });
        await this.complete(actionId);
        this.logger.log(`Lead ${ctx.lead.id}: invitation already pending (cannot_resend_yet) — advanced to CONNECTION_PENDING`);
        return;
      }
      throw err;
    }

    await this.prisma.liLead.update({
      where: { id: ctx.lead.id },
      data: {
        status: LiLeadStatus.CONNECTION_PENDING, currentStep: 1, lastActionAt: new Date(),
        unipileInvitationId: invitationId || undefined, // stored so we can withdraw if never accepted
      },
    });
    await this.complete(actionId);
    // Follow-ups only begin once the invite is ACCEPTED — LinkedIn won't deliver DMs to
    // non-connections — so nothing is scheduled here. The 3-hourly sync sweep detects
    // acceptance for the whole seat from one relations call and kicks off the first
    // message; no per-lead acceptance polling is scheduled (it cost a profile read each).
  }

  /**
   * Retired: acceptance is detected in bulk, not per lead.
   *
   * This used to call isConnectionAccepted() — a full profile read — for every pending
   * invite on every rung of the ladder. That is ~2 profile reads per pending lead per
   * day, so ~40 outstanding invites alone exhausted the seat's entire daily budget and
   * the engine started deferring real sends with "daily profile-read budget reached".
   *
   * The 3-hourly sync sweep already resolves acceptance for the whole seat from ONE
   * relations call, and withdrawStaleInvites() owns retiring invites that were never
   * accepted (checking relations first, so a late acceptance is promoted rather than
   * binned). Nothing here was left to do that those two don't do more cheaply.
   *
   * Kept as a no-op so any rungs already queued in Redis retire quietly instead of
   * failing; no new ones are scheduled.
   */
  private async doCheckAcceptance(actionId: string, _attempts: number, _ctx: LeadWithContext) {
    return this.complete(actionId);
  }

  private async doSendMessage(actionId: string, stepOrder: number, ctx: LeadWithContext) {
    const sentToday = await this.scheduler.messagesSentTodayForCampaign(ctx.campaign.id);
    if (sentToday >= ctx.campaign.dailyMessageLimit) return this.scheduler.rearm(actionId, this.scheduler.nextDeferralSlot(ctx.campaign));

    // Seat-level ceiling (see doSendConnection): campaigns sharing a seat share a budget.
    const seatSentToday = await this.scheduler.messagesSentTodayForAccount(ctx.account.id);
    if (seatSentToday >= ctx.account.dailyMessageLimit) {
      this.logger.warn(`Seat ${ctx.account.id} hit its daily message ceiling (${ctx.account.dailyMessageLimit}) — deferring`);
      return this.scheduler.rearm(actionId, this.scheduler.nextDeferralSlot(ctx.campaign));
    }

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

    // The message is already out. Nothing below may throw, or the job replays
    // and sends it again — see linkConversation.
    const conversation = await linkConversation(this.prisma, ctx.lead.id, res.chatId, (m) =>
      this.logger.warn(m),
    );
    await this.prisma.liMessage.create({
      data: { conversationId: conversation.id, direction: LiMessageDirection.OUTBOUND, source: LiMessageSource.AUTO, body: text, unipileMessageId: res.messageId || null },
    });
    await this.prisma.liLead.update({ where: { id: ctx.lead.id }, data: { status: LiLeadStatus.MESSAGED, currentStep: stepOrder, lastActionAt: new Date() } });
    await this.complete(actionId);
    await this.scheduleNextMessage(ctx, stepOrder);
  }

  /**
   * Queue the next MESSAGE "unit" on the timeline. A unit is either a single step or a
   * random-choice group (steps sharing a randomGroup); for a group, exactly ONE member
   * is picked at random and scheduled with its own waitHours ("N hours after the
   * previous step"). Whether a step actually sends is decided when it fires (see
   * doSendMessage). `afterOrder` is the order of the step just handled — units are
   * matched by their lowest member order, so the current unit is naturally skipped.
   */
  private async scheduleNextMessage(ctx: LeadWithContext, afterOrder: number) {
    const assigned = await this.resolveAssignedMessages(ctx);
    const units = messageUnits(ctx.steps);
    const nextIdx = units.findIndex((u) => u.minOrder > afterOrder);
    if (nextIdx >= 0 && nextIdx + 1 <= assigned) {
      const unit = units[nextIdx];
      // Random group → one member goes out (picked per-lead); single step → itself.
      const chosen = unit.steps.length === 1
        ? unit.steps[0]
        : unit.steps[Math.floor(Math.random() * unit.steps.length)];
      await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.SEND_MESSAGE, chosen.order, new Date(Date.now() + chosen.waitHours * 60 * 60 * 1000));
      return;
    }
    // No further messages for this lead → open the grace window, then mark completed.
    const graceMs = Math.max(0, ctx.campaign.graceHours ?? 96) * 60 * 60 * 1000;
    await this.scheduler.schedule(ctx.lead.id, LiScheduledActionType.COMPLETE_LEAD, undefined, new Date(Date.now() + graceMs));
  }

  /**
   * Draw (once, then persist) how many follow-up TOUCHES this lead receives, from the
   * campaign's [followUpMin, followUpMax]. A random-choice group counts as one touch.
   * 0/0 (feature off) → all configured units. Clamped to the units that exist.
   */
  private async resolveAssignedMessages(ctx: LeadWithContext): Promise<number> {
    if (ctx.lead.assignedMessages != null) return ctx.lead.assignedMessages;
    const total = messageUnits(ctx.steps).length;
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
  private async doCompleteLead(actionId: string, ctx: LoadedContext) {
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
        connectionsCount: member.connectionsCount ?? ctx.lead.connectionsCount ?? undefined,
      },
    });
    ctx.lead.unipileMemberId = member.memberId;
    ctx.lead.firstName = name.firstName ?? ctx.lead.firstName;
    ctx.lead.connectionsCount = member.connectionsCount ?? ctx.lead.connectionsCount;
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
          // Freshly-sourced leads just join the pending bucket; the daily pull schedules
          // them when their day comes. Nudge the due-day pull in case it wasn't filled yet.
          await this.scheduler.scheduleDueDays(c.id);
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
 * Whether a send error means "an invitation to this person already exists" — LinkedIn
 * rejects re-inviting the same member within its cooldown (Unipile: cannot_resend_yet).
 * Treated as already-pending, not a real failure.
 */
function isAlreadyInvited(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return /cannot_resend_yet|already[\s_-]*(invited|connected|sent)|invitation already/i.test(msg);
}

/**
 * Whether an error means the LinkedIn SEAT is the problem (not the lead): a security
 * checkpoint, an expired/disconnected session, or the account being rate-limited by
 * LinkedIn. These should flag the seat for re-auth and defer leads, not burn them.
 */
function isAccountDown(msg: string): boolean {
  return /checkpoint|disconnected|invalid[\s_-]*credential|credentials|re-?auth|unauthor|session[\s_-]*expired|not[\s_-]*connected|account[\s_-]*(restricted|suspended|blocked)|too[\s_-]*many[\s_-]*requests|rate[\s_-]*limit|\b401\b|\b403\b|\b429\b/i.test(msg);
}

/**
 * A LinkedIn member-id slug (ACxAA…, base64url) that is ALL lowercase was corrupted by the
 * old URL normalizer (correct ids are mixed-case) and can never be resolved → the lead is
 * dead weight and should be excluded + backfilled rather than retried forever.
 */
function isCorruptedMemberIdUrl(url?: string | null): boolean {
  if (!url) return false;
  const m = url.match(/\/in\/([^/?#]+)/i);
  return !!m && /^ac[a-z]aa[a-z0-9_-]{25,}$/.test(m[1]); // starts with acXaa, long, entirely lowercase
}

/** A permanent per-lead failure: the profile/member simply can't be resolved (not a transient
 *  network blip like "fetch failed", not an account-level checkpoint). */
function isUnresolvableLead(msg: string): boolean {
  if (/fetch failed|timeout|ETIMEDOUT|ECONNRESET|network/i.test(msg)) return false; // transient → let it retry
  return /not[\s_-]*found|no[\s_-]*such|unresolv|invalid[\s_-]*(identifier|profile|member|provider|url)|could[\s_-]*not[\s_-]*(resolve|find)|does[\s_-]*not[\s_-]*exist|unknown[\s_-]*(member|profile|user)/i.test(msg);
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

interface MessageStep { order: number; waitHours: number; randomGroup: number | null }
interface MessageUnit { minOrder: number; steps: MessageStep[] }

/**
 * Collapse a campaign's MESSAGE steps into ordered "units". A step with a null
 * randomGroup is its own unit; steps sharing a non-null randomGroup collapse into one
 * unit (a random-choice group — exactly one member is sent per lead). Units are
 * returned sorted by their lowest member order, so the sequence walks them in place.
 */
function messageUnits(steps: readonly { type: string; order: number; waitHours: number; randomGroup?: number | null }[]): MessageUnit[] {
  const msgs = steps
    .filter((s) => s.type === 'MESSAGE')
    .map((s) => ({ order: s.order, waitHours: s.waitHours, randomGroup: s.randomGroup ?? null }))
    .sort((a, b) => a.order - b.order);
  const units: MessageUnit[] = [];
  const groups = new Map<number, MessageUnit>();
  for (const s of msgs) {
    if (s.randomGroup != null) {
      const existing = groups.get(s.randomGroup);
      if (existing) { existing.steps.push(s); existing.minOrder = Math.min(existing.minOrder, s.order); }
      else { const u = { minOrder: s.order, steps: [s] }; groups.set(s.randomGroup, u); units.push(u); }
    } else {
      units.push({ minOrder: s.order, steps: [s] });
    }
  }
  return units.sort((a, b) => a.minOrder - b.minOrder);
}
