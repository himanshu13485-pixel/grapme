import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import {
  ClientReportService,
  ReportPeriod,
} from './client-report.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly clientReports: ClientReportService,
  ) {}

  @Get('dashboard/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.reports.summary(user);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get('activity-logs')
  activityLogs(@CurrentUser() user: AuthUser) {
    return this.reports.activityLogs(user);
  }

  /** Address client reports are sent FROM (admin mailbox), for confirmation. */
  @Get('reports/sender')
  reportSender(@CurrentUser() user: AuthUser) {
    return this.clientReports.senderAddress(user.tenantId);
  }

  /** Mailboxes selectable as the report sender. */
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get('reports/sender-options')
  reportSenderOptions(@CurrentUser() user: AuthUser) {
    return this.clientReports.senderOptions(user.tenantId);
  }

  /** Pick (or clear) the mailbox client reports send from. */
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Post('reports/sender')
  setReportSender(
    @CurrentUser() user: AuthUser,
    @Body('mailboxId') mailboxId: string | null,
  ) {
    return this.clientReports.setSender(user.tenantId, mailboxId || null);
  }

  /** Send a client report now (test / on-demand). */
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Post('clients/:id/report')
  sendReport(
    @Param('id') id: string,
    @Query('period') period: ReportPeriod = 'daily',
  ) {
    return this.clientReports.sendReport(id, period);
  }

  /** Manual trigger of the due-report sweep across all clients. */
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  @Post('reports/run-due')
  runDue() {
    return this.clientReports.runDueReports();
  }
}
