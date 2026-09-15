import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LiCampaignStatus, LiLeadStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiCampaignsService } from './li-campaigns.service';
import { LiGenerationService } from './li-generation.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto,
  UpsertLiAudienceDto, UpdateLiScheduleDto, ImportLiLeadsDto, GenerateLiMessagesDto,
  DraftLiMessagesDto,
} from './dto/campaign.dto';

@Controller('linkedin/campaigns')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LiCampaignsController {
  constructor(
    private readonly campaigns: LiCampaignsService,
    private readonly generation: LiGenerationService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLiCampaignDto) {
    return this.campaigns.create(user.tenantId, dto);
  }

  @Get()
  list(@Query('clientId') clientId: string, @Query('view') view?: string) {
    return this.campaigns.list(clientId, view);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.campaigns.stats(id, { period, from, to });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLiCampaignDto) {
    return this.campaigns.update(id, dto);
  }

  @Patch(':id/sequence')
  updateSequence(@Param('id') id: string, @Body() dto: UpdateLiSequenceDto) {
    return this.campaigns.updateSequence(id, dto);
  }

  @Patch(':id/audience')
  upsertAudience(@Param('id') id: string, @Body() dto: UpsertLiAudienceDto) {
    return this.campaigns.upsertAudience(id, dto);
  }

  @Patch(':id/schedule')
  updateSchedule(@Param('id') id: string, @Body() dto: UpdateLiScheduleDto) {
    return this.campaigns.updateSchedule(id, dto);
  }

  @Post(':id/leads')
  importLeads(@Param('id') id: string, @Body() dto: ImportLiLeadsDto) {
    return this.campaigns.importLeads(id, dto);
  }

  @Delete(':id/leads/:leadId')
  deleteLead(@Param('id') id: string, @Param('leadId') leadId: string) {
    return this.campaigns.deleteLead(id, leadId);
  }

  /** Bulk-remove leads from the audience (admin cleanup, e.g. duplicates). */
  @Post(':id/leads/delete')
  deleteLeads(@Param('id') id: string, @Body() body: { leadIds?: string[] }) {
    return this.campaigns.deleteLeads(id, body?.leadIds ?? []);
  }

  /** Admin test: fire this one lead's next action now (daily caps + warm-up still apply). */
  @Post(':id/leads/:leadId/send-now')
  sendNowForLead(@Param('id') id: string, @Param('leadId') leadId: string) {
    return this.campaigns.sendNowForLead(id, leadId);
  }

  /** Replicate a campaign (settings + audience criteria + sequence) as a new draft. */
  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.campaigns.duplicate(id);
  }

  @Get(':id/leads')
  leads(
    @Param('id') id: string,
    @Query('status') status?: LiLeadStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('step') step?: string,
    @Query('sentFrom') sentFrom?: string,
    @Query('sentTo') sentTo?: string,
  ) {
    return this.campaigns.leads(id, {
      status, search, sentFrom, sentTo,
      step: step != null && step !== '' ? Number(step) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Per-lead action timeline (when each step was sent). */
  @Get(':id/leads/:leadId/log')
  leadLog(@Param('id') id: string, @Param('leadId') leadId: string) {
    return this.campaigns.leadLog(id, leadId);
  }

  @Post(':id/generate-audience')
  generateAudience(@Param('id') id: string) {
    return this.generation.generateAudience(id);
  }

  @Post(':id/generate-messages')
  generateMessages(@Param('id') id: string, @Body() dto: GenerateLiMessagesDto) {
    return this.generation.generateMessages(id, dto);
  }

  /** Prompt-based sequence draft for the manual editor (no knowledge needed,
   *  nothing persisted — the editor fills the form and the user saves). */
  @Post('draft-messages')
  draftMessages(@Body() dto: DraftLiMessagesDto) {
    const { clientId, ...rest } = dto;
    return this.generation.draftMessages(clientId, rest);
  }

  @Post(':id/source-leads')
  sourceLeads(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.generation.sourceLeads(id, limit ? Number(limit) : undefined);
  }

  /** Bulk-import the seat's own existing 1st-degree connections into this campaign. */
  @Post(':id/import-connections')
  importConnections(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.generation.importConnections(id, limit ? Number(limit) : undefined);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.PAUSED);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.RUNNING);
  }

  /** Attach a (new) LinkedIn account — e.g. after the campaign's old account was removed. */
  @Post(':id/account')
  attachAccount(@Param('id') id: string, @Body('linkedInAccountId') linkedInAccountId: string) {
    return this.campaigns.attachAccount(id, linkedInAccountId);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.ARCHIVED);
  }

  @Post(':id/delete')
  softDelete(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.DELETED);
  }

  /** Restore a soft-deleted / archived campaign back to Draft. */
  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.campaigns.restore(id);
  }

  /** Hard delete (permanent) — admin only, from the Deleted tab. */
  @Post(':id/hard-delete')
  hardDelete(@Param('id') id: string) {
    return this.campaigns.hardDelete(id);
  }

  /** Admin test: fire the campaign's next scheduled action immediately. */
  @Post(':id/send-next')
  sendNext(@Param('id') id: string) {
    return this.campaigns.sendNextNow(id);
  }

  /** Admin: refresh lead profiles + check acceptance from LinkedIn now (no 6h wait). */
  @Post(':id/sync')
  sync(@Param('id') id: string) {
    return this.campaigns.syncConnections(id);
  }

  /** Admin: re-spread pending invites across working days (fix single-day pile-ups). */
  @Post(':id/respace')
  respace(@Param('id') id: string) {
    return this.campaigns.respaceSchedule(id);
  }

  /** Admin: at-a-glance schedule status (today/next planned vs cap + pending bucket). */
  @Get(':id/schedule-status')
  scheduleStatus(@Param('id') id: string) {
    return this.campaigns.scheduleStatus(id);
  }
}
