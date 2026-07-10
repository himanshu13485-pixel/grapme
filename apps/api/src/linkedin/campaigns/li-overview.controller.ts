import { Controller, Get, Query } from '@nestjs/common';
import { LiCampaignStatus, LiLeadStatus, Role } from '@prisma/client';
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.campaigns.globalSchedule(u.tenantId, {
      clientSearch: client, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('leads')
  leads(
    @CurrentUser() u: AuthUser,
    @Query('client') client?: string,
    @Query('status') status?: LiLeadStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('all') all?: string,
  ) {
    return this.campaigns.globalLeads(u.tenantId, {
      clientSearch: client, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      all: all === 'true',
    });
  }
}
