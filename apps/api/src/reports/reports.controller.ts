import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.reports.summary(user);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get('activity-logs')
  activityLogs(@CurrentUser() user: AuthUser) {
    return this.reports.activityLogs(user);
  }
}
