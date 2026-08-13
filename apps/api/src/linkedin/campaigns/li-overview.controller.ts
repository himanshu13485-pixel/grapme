import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LiCampaignStatus, LiLeadStatus, LiScheduledActionStatus, LiScheduledActionType, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiCampaignsService } from './li-campaigns.service';

/** Admin cross-client LinkedIn overviews: campaign schedule board + leads directory. */
@Controller('linkedin/overview')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LiOverviewController {
  constructor(private readonly campaigns: LiCampaignsService) {}

  @Get('schedule')
  schedule(
    @CurrentUser() u: AuthUser,
    @Query('client') client?: string,
    @Query('status') status?: LiCampaignStatus,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.campaigns.globalSchedule(u.tenantId, {
      clientSearch: client, status, range, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Emergency controls across every client's LinkedIn campaigns. */
  @Post('pause-all')
  pauseAll(@CurrentUser() u: AuthUser) { return this.campaigns.emergencyControl(u.tenantId, 'pause'); }
  @Post('resume-all')
  resumeAll(@CurrentUser() u: AuthUser) { return this.campaigns.emergencyControl(u.tenantId, 'resume'); }
  @Post('stop-all')
  stopAll(@CurrentUser() u: AuthUser) { return this.campaigns.emergencyControl(u.tenantId, 'stop'); }

  @Get('leads')
  leads(
    @CurrentUser() u: AuthUser,
    @Query('client') client?: string,
    @Query('status') status?: LiLeadStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('all') all?: string,
    @Query('step') step?: string,
    @Query('sentFrom') sentFrom?: string,
    @Query('sentTo') sentTo?: string,
  ) {
    return this.campaigns.globalLeads(u.tenantId, {
      clientSearch: client, status, sentFrom, sentTo,
      step: step != null && step !== '' ? Number(step) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      all: all === 'true',
    });
  }

  /** Per-lead action timeline for the directory's Log button. */
  @Get('leads/:campaignId/:leadId/log')
  leadLog(@Param('campaignId') campaignId: string, @Param('leadId') leadId: string) {
    return this.campaigns.leadLog(campaignId, leadId);
  }

  /** How many leads were auto-excluded for corrupted profile links (need re-import). */
  @Get('excluded-corrupted')
  excludedCorrupted(@CurrentUser() u: AuthUser) {
    return this.campaigns.excludedCorruptedCount(u.tenantId);
  }

  /** Cross-client LinkedIn activity log (scheduled actions), defaults to today. */
  @Get('actions')
  actions(
    @CurrentUser() u: AuthUser,
    @Query('client') client?: string,
    @Query('status') status?: LiScheduledActionStatus,
    @Query('type') type?: LiScheduledActionType,
    @Query('step') step?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.campaigns.globalActions(u.tenantId, {
      clientSearch: client, status, type, from, to,
      step: step != null && step !== '' ? Number(step) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
