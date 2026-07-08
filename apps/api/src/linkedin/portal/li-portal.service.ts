import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ApprovalEntity, LiCampaignStatus, LiMessageSource, LiOutreachType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { LinkedInAccountsService } from '../accounts/linkedin-accounts.service';
import { LiCampaignsService } from '../campaigns/li-campaigns.service';
import { LiGenerationService } from '../campaigns/li-generation.service';
import { LiKnowledgeService } from '../knowledge/li-knowledge.service';
import { LiInboxService, InboxTab } from '../inbox/li-inbox.service';
import { ApprovalsService } from '../../approvals/approvals.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto, UpsertLiAudienceDto, UpdateLiScheduleDto,
} from '../campaigns/dto/campaign.dto';

/**
 * Client-portal facade for the LinkedIn channel. Every method verifies the CLIENT
 * user owns the target client/resource, then delegates to the admin services.
 * Clients build campaigns and use the inbox; LAUNCHING goes through approvals.
 */
@Injectable()
export class LiPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: LinkedInSubscriptionService,
    private readonly accounts: LinkedInAccountsService,
    private readonly campaigns: LiCampaignsService,
    private readonly generation: LiGenerationService,
    private readonly knowledge: LiKnowledgeService,
    private readonly inbox: LiInboxService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ── ownership guards ─────────────────────────────────────────────────
  async assertOwnsClient(userId: string, clientId: string) {
    const owned = await this.prisma.client.count({ where: { id: clientId, ownerUserId: userId } });
    if (!owned) throw new ForbiddenException('You do not have access to this client');
  }
  private async campaignClientId(id: string) {
    const c = await this.prisma.liCampaign.findUnique({ where: { id }, select: { clientId: true } });
    if (!c) throw new BadRequestException('Campaign not found');
    return c.clientId;
  }
  private async conversationClientId(id: string) {
    const c = await this.prisma.liConversation.findUnique({ where: { id }, select: { lead: { select: { campaign: { select: { clientId: true } } } } } });
    if (!c) throw new BadRequestException('Conversation not found');
    return c.lead.campaign.clientId;
  }
  private async profileClientId(id: string) {
    const p = await this.prisma.liKnowledgeProfile.findUnique({ where: { id }, select: { clientId: true } });
    if (!p) throw new BadRequestException('Profile not found');
    return p.clientId;
  }
  private async assertCampaign(userId: string, id: string) { await this.assertOwnsClient(userId, await this.campaignClientId(id)); }
  private async assertConversation(userId: string, id: string) { await this.assertOwnsClient(userId, await this.conversationClientId(id)); }
  private async assertProfile(userId: string, id: string) { await this.assertOwnsClient(userId, await this.profileClientId(id)); }

  // ── read: subscription / accounts / stats ────────────────────────────
  async subscription(userId: string, tenantId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.subs.getOrCreate(tenantId, clientId); }
  async accountsList(userId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.accounts.list(clientId); }
  async knowledgeStats(userId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.knowledge.clientStats(clientId); }

  // ── knowledge (business/strategy interviews) ─────────────────────────
  async listBusiness(userId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.knowledge.listBusinessProfiles(clientId); }
  async createBusiness(userId: string, tenantId: string, clientId: string, name: string) { await this.assertOwnsClient(userId, clientId); return this.knowledge.createBusinessProfile(tenantId, clientId, name); }
  async listStrategies(userId: string, businessId: string) { await this.assertProfile(userId, businessId); return this.knowledge.listStrategies(businessId); }
  async createStrategy(userId: string, businessId: string, name: string) { await this.assertProfile(userId, businessId); return this.knowledge.createStrategy(businessId, name); }
  async profileDetails(userId: string, id: string) { await this.assertProfile(userId, id); return this.knowledge.details(id); }
  async profileChat(userId: string, id: string) { await this.assertProfile(userId, id); return this.knowledge.chat(id); }
  async profileAnswer(userId: string, id: string, text: string) { await this.assertProfile(userId, id); return this.knowledge.answer(id, text); }

  // ── campaigns (build; launch via approval) ───────────────────────────
  async createCampaign(userId: string, tenantId: string, dto: CreateLiCampaignDto) {
    await this.assertOwnsClient(userId, dto.clientId);
    return this.campaigns.create(tenantId, dto);
  }
  async updateCampaign(userId: string, id: string, dto: UpdateLiCampaignDto) { await this.assertCampaign(userId, id); return this.campaigns.update(id, dto); }
  async listCampaigns(userId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.campaigns.list(clientId); }
  async getCampaign(userId: string, id: string) { await this.assertCampaign(userId, id); return this.campaigns.get(id); }
  async campaignStats(userId: string, id: string) { await this.assertCampaign(userId, id); return this.campaigns.stats(id); }
  async campaignLeads(userId: string, id: string, opts: any) { await this.assertCampaign(userId, id); return this.campaigns.leads(id, opts); }
  async updateAudience(userId: string, id: string, dto: UpsertLiAudienceDto) { await this.assertCampaign(userId, id); return this.campaigns.upsertAudience(id, dto); }
  async updateSequence(userId: string, id: string, dto: UpdateLiSequenceDto) { await this.assertCampaign(userId, id); return this.campaigns.updateSequence(id, dto); }
  async updateSchedule(userId: string, id: string, dto: UpdateLiScheduleDto) { await this.assertCampaign(userId, id); return this.campaigns.updateSchedule(id, dto); }
  async generateAudience(userId: string, id: string) { await this.assertCampaign(userId, id); return this.generation.generateAudience(id); }
  async generateMessages(userId: string, id: string, opts: { outreachType?: LiOutreachType; followUps?: number }) { await this.assertCampaign(userId, id); return this.generation.generateMessages(id, opts); }

  /** Client submits a built campaign for admin approval to launch. */
  async submitForApproval(userId: string, tenantId: string, id: string) {
    await this.assertCampaign(userId, id);
    const c = await this.campaigns.get(id);
    if (c.status !== LiCampaignStatus.DRAFT && c.status !== LiCampaignStatus.PAUSED) {
      throw new BadRequestException('Only draft campaigns can be submitted for approval');
    }
    if (c.steps.length === 0) throw new BadRequestException('Add at least one message before submitting');
    await this.approvals.submit({ tenantId, entityType: ApprovalEntity.LI_CAMPAIGN, entityId: id, submittedById: userId });
    return { ok: true, status: 'PENDING_APPROVAL' };
  }
  async pause(userId: string, id: string) { await this.assertCampaign(userId, id); return this.campaigns.setStatus(id, LiCampaignStatus.PAUSED); }
  async resume(userId: string, id: string) {
    await this.assertCampaign(userId, id);
    const c = await this.campaigns.get(id);
    if (c.status !== LiCampaignStatus.PAUSED) throw new BadRequestException('Submit for approval to launch a draft campaign');
    return this.campaigns.setStatus(id, LiCampaignStatus.RUNNING);
  }

  // ── inbox ────────────────────────────────────────────────────────────
  async inboxList(userId: string, clientId: string, opts: { tab?: InboxTab; accountId?: string; search?: string; page?: number; pageSize?: number }) { await this.assertOwnsClient(userId, clientId); return this.inbox.list(clientId, opts); }
  async inboxCounts(userId: string, clientId: string) { await this.assertOwnsClient(userId, clientId); return this.inbox.counts(clientId); }
  async thread(userId: string, id: string) { await this.assertConversation(userId, id); return this.inbox.thread(id); }
  async markRead(userId: string, id: string) { await this.assertConversation(userId, id); return this.inbox.markRead(id); }
  async reply(userId: string, id: string, text: string, source: LiMessageSource) { await this.assertConversation(userId, id); return this.inbox.reply(id, text, source); }
  async aiFetch(userId: string, id: string) { await this.assertConversation(userId, id); return this.inbox.aiFetch(id); }
}
