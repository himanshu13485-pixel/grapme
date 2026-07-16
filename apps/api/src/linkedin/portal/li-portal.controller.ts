import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { LiCampaignStatus, LiLeadStatus, LiMessageSource, LiOutreachType, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiPortalService } from './li-portal.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto, UpsertLiAudienceDto, UpdateLiScheduleDto, ImportLiLeadsDto,
} from '../campaigns/dto/campaign.dto';

class NameDto { @IsString() @MinLength(2) name!: string; }
class AnswerDto { @IsString() @MinLength(1) text!: string; }
class ReplyDto { @IsString() @MinLength(1) text!: string; @IsOptional() @IsIn(['MANUAL', 'AI']) source?: 'MANUAL' | 'AI'; }
class GenMsgDto { @IsOptional() @IsEnum(LiOutreachType) outreachType?: LiOutreachType; @IsOptional() @IsInt() @Min(1) @Max(5) followUps?: number; @IsOptional() @IsInt() @Min(1) @Max(3) variants?: number; }
class ConnectDto { @IsOptional() @IsString() successRedirect?: string; }

/** Client-portal LinkedIn API (CLIENT role; ownership enforced in the service). */
@Controller('linkedin/portal')
@Roles(Role.CLIENT)
export class LiPortalController {
  constructor(private readonly portal: LiPortalService) {}

  @Get('clients/:clientId/subscription')
  subscription(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.subscription(u.userId, u.tenantId, clientId); }

  @Get('clients/:clientId/linkedin-accounts')
  accounts(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.accountsList(u.userId, clientId); }

  @Post('clients/:clientId/linkedin-accounts/connect')
  connect(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Body() d: ConnectDto) { return this.portal.connectAccount(u.userId, u.tenantId, clientId, d.successRedirect); }

  @Delete('linkedin-accounts/:id')
  removeAccount(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.removeAccount(u.userId, id); }

  @Get('clients/:clientId/knowledge-stats')
  stats(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.knowledgeStats(u.userId, clientId); }

  // Knowledge
  @Get('clients/:clientId/business-profiles')
  listBusiness(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.listBusiness(u.userId, clientId); }
  @Post('clients/:clientId/business-profiles')
  createBusiness(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Body() d: NameDto) { return this.portal.createBusiness(u.userId, u.tenantId, clientId, d.name); }
  @Get('business-profiles/:id/strategies')
  listStrategies(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.listStrategies(u.userId, id); }
  @Post('business-profiles/:id/strategies')
  createStrategy(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: NameDto) { return this.portal.createStrategy(u.userId, id, d.name); }
  @Get('knowledge-profiles/:id/details')
  details(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.profileDetails(u.userId, id); }
  @Get('knowledge-profiles/:id/chat')
  chat(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.profileChat(u.userId, id); }
  @Post('knowledge-profiles/:id/chat')
  answer(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: AnswerDto) { return this.portal.profileAnswer(u.userId, id, d.text); }

  // Campaigns (build + submit for approval)
  @Post('campaigns')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateLiCampaignDto) { return this.portal.createCampaign(u.userId, u.tenantId, dto); }
  @Get('campaigns')
  list(@CurrentUser() u: AuthUser, @Query('clientId') clientId: string, @Query('view') view?: string) { return this.portal.listCampaigns(u.userId, clientId, view); }
  @Post('campaigns/:id/delete')
  deleteCampaign(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.deleteCampaign(u.userId, id); }
  @Post('campaigns/:id/archive')
  archiveCampaign(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.archiveCampaign(u.userId, id); }
  @Post('campaigns/:id/restore')
  restoreCampaign(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.restoreCampaign(u.userId, id); }
  @Get('clients/:clientId/schedule')
  clientSchedule(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.schedule(u.userId, u.tenantId, clientId); }
  @Get('campaigns/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.getCampaign(u.userId, id); }
  @Patch('campaigns/:id')
  updateCampaign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateLiCampaignDto) { return this.portal.updateCampaign(u.userId, id, dto); }
  @Get('campaigns/:id/stats')
  cstats(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.portal.campaignStats(u.userId, id, { period, from, to }); }
  @Get('campaigns/:id/leads')
  leads(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('status') status?: LiLeadStatus, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('search') search?: string) {
    return this.portal.campaignLeads(u.userId, id, { status, search, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }
  @Post('campaigns/:id/leads')
  importLeads(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ImportLiLeadsDto) { return this.portal.importLeads(u.userId, id, dto); }
  @Delete('campaigns/:id/leads/:leadId')
  deleteLead(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('leadId') leadId: string) { return this.portal.deleteLead(u.userId, id, leadId); }

  @Get('clients/:clientId/audience-presets')
  presets(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) { return this.portal.listPresets(u.userId, u.tenantId, clientId); }
  @Post('clients/:clientId/audience-presets')
  createPreset(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Body() dto: { name: string; spec: unknown }) { return this.portal.createPreset(u.userId, u.tenantId, clientId, dto.name, dto.spec); }
  @Delete('clients/:clientId/audience-presets/:id')
  deletePreset(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Param('id') id: string) { return this.portal.deletePreset(u.userId, u.tenantId, clientId, id); }
  @Post('campaigns/:id/import-connections')
  importConnections(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) { return this.portal.importConnections(u.userId, id, limit ? Number(limit) : undefined); }
  // Audience sourcing is admin-only (avoids client-side credit/rate-limit misuse);
  // clients import leads manually, and admins configure drip auto-sourcing.
  @Patch('campaigns/:id/audience')
  audience(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpsertLiAudienceDto) { return this.portal.updateAudience(u.userId, id, dto); }
  @Patch('campaigns/:id/sequence')
  sequence(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateLiSequenceDto) { return this.portal.updateSequence(u.userId, id, dto); }
  @Patch('campaigns/:id/schedule')
  schedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateLiScheduleDto) { return this.portal.updateSchedule(u.userId, id, dto); }
  @Post('campaigns/:id/generate-audience')
  genAud(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.generateAudience(u.userId, id); }
  @Post('campaigns/:id/generate-messages')
  genMsg(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: GenMsgDto) { return this.portal.generateMessages(u.userId, id, d); }
  @Post('campaigns/:id/submit')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.submitForApproval(u.userId, u.tenantId, id); }
  @Post('campaigns/:id/pause')
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.pause(u.userId, id); }
  @Post('campaigns/:id/resume')
  resume(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.resume(u.userId, id); }

  // Inbox
  @Get('clients/:clientId/inbox')
  inbox(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Query('tab') tab?: any, @Query('accountId') accountId?: string, @Query('search') search?: string, @Query('page') page?: string) {
    return this.portal.inboxList(u.userId, clientId, { tab, accountId, search, page: page ? Number(page) : undefined });
  }
  @Get('clients/:clientId/inbox/counts')
  inboxCounts(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Query('accountId') accountId?: string) { return this.portal.inboxCounts(u.userId, clientId, accountId); }
  @Get('conversations/:id')
  thread(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.thread(u.userId, id); }
  @Post('conversations/:id/read')
  read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.markRead(u.userId, id); }
  @Post('conversations/:id/reply')
  reply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ReplyDto) { return this.portal.reply(u.userId, id, d.text, d.source === 'AI' ? LiMessageSource.AI : LiMessageSource.MANUAL); }
  @Post('conversations/:id/ai-fetch')
  aiFetch(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.portal.aiFetch(u.userId, id); }
}
