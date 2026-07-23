import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { SalesService } from './sales.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import {
  AssignClientsDto,
  CreateSalesPersonDto,
  UpdateSalesPersonDto,
} from './dto/sales.dto';

const ADMIN = [Role.SUPER_ADMIN, Role.SUB_ADMIN] as const;

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // ── Admin: manage salespersons + assignment ──
  @Roles(...ADMIN)
  @Get('persons')
  listPersons(@CurrentUser('tenantId') tenantId: string) {
    return this.sales.listPersons(tenantId);
  }

  @Roles(...ADMIN)
  @Post('persons')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesPersonDto) {
    return this.sales.create(user, dto);
  }

  @Roles(...ADMIN)
  @Get('persons/:id')
  getPerson(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.sales.getPerson(tenantId, id);
  }

  @Roles(...ADMIN)
  @Patch('persons/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSalesPersonDto,
  ) {
    return this.sales.update(user, id, dto);
  }

  @Roles(...ADMIN)
  @Delete('persons/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.remove(user, id);
  }

  @Roles(...ADMIN)
  @Post('persons/:id/unassign/:clientId')
  unassignClient(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('clientId') clientId: string,
  ) {
    return this.sales.unassignClient(user, id, clientId);
  }

  @Roles(...ADMIN)
  @Post('assign')
  assign(@CurrentUser() user: AuthUser, @Body() dto: AssignClientsDto) {
    return this.sales.assignClients(user, dto);
  }

  // ── Sales-scoped: the salesperson's own panel ──
  @Roles(Role.SALES)
  @Get('my/overview')
  myOverview(@CurrentUser() user: AuthUser) {
    return this.sales.myOverview(user);
  }

  /** Admin-style activity dashboard, scoped to this salesperson's clients.
   *  Optional narrowing: ?clientId=… ?campaignId=… ?liCampaignId=… */
  @Roles(Role.SALES)
  @Get('my/dashboard')
  myDashboard(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('liCampaignId') liCampaignId?: string,
  ) {
    return this.sales.dashboard(user, { clientId, campaignId, liCampaignId });
  }

  @Roles(Role.SALES)
  @Get('my/clients')
  myClients(@CurrentUser() user: AuthUser) {
    return this.sales.myClients(user);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id')
  myClient(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.myClient(user, id);
  }

  // Read-only drill-down into an owned client's outreach activity.
  @Roles(Role.SALES)
  @Get('my/clients/:id/stats')
  clientStats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.clientStats(user, id);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/campaigns')
  clientCampaigns(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.sales.clientCampaigns(user, id, page, pageSize);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/cohorts')
  clientCohorts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.sales.clientCohorts(user, id, page, pageSize);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/contacts')
  clientContacts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.sales.clientContacts(user, id, page, pageSize);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/li-campaigns')
  clientLiCampaigns(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.sales.clientLiCampaigns(user, id, page, pageSize);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/mailboxes')
  clientMailboxes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.clientMailboxes(user, id);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/sequence')
  clientSequence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.clientSequence(user, id);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/templates')
  clientTemplates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.clientTemplates(user, id);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/linkedin')
  clientLinkedIn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sales.clientLinkedIn(user, id);
  }

  @Roles(Role.SALES)
  @Get('my/clients/:id/li-leads')
  clientLiLeads(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.sales.clientLiLeads(user, id, page, pageSize);
  }
}
