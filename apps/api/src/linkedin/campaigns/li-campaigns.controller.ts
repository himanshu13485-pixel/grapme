import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LiCampaignStatus, LiLeadStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiCampaignsService } from './li-campaigns.service';
import { LiGenerationService } from './li-generation.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto,
  UpsertLiAudienceDto, UpdateLiScheduleDto, ImportLiLeadsDto, GenerateLiMessagesDto,
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

  @Get(':id/leads')
  leads(
    @Param('id') id: string,
    @Query('status') status?: LiLeadStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.campaigns.leads(id, {
      status, search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':id/generate-audience')
  generateAudience(@Param('id') id: string) {
    return this.generation.generateAudience(id);
  }

  @Post(':id/generate-messages')
  generateMessages(@Param('id') id: string, @Body() dto: GenerateLiMessagesDto) {
    return this.generation.generateMessages(id, dto);
  }

  @Post(':id/source-leads')
  sourceLeads(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.generation.sourceLeads(id, limit ? Number(limit) : undefined);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.PAUSED);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.campaigns.setStatus(id, LiCampaignStatus.RUNNING);
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
}
