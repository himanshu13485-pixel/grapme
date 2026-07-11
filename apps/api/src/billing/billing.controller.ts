import { Body, Controller, Get, Param, Post, Patch, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.billing.settings(user);
  }

  @Patch('settings')
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  setMode(@CurrentUser() user: AuthUser, @Body() dto: { paymentMode: string }) {
    return this.billing.setMode(user, dto.paymentMode);
  }

  /** Client (or admin) requests to move onto a plan. */
  @Post('plan-requests')
  request(@CurrentUser() user: AuthUser, @Body() dto: { clientId: string; plan: string; currency?: string; period?: string }) {
    return this.billing.requestPlan(user, dto);
  }

  @Get('plan-requests')
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.billing.listRequests(user, { status, q, page, pageSize });
  }

  @Post('plan-requests/:id/activate')
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.activate(user, id);
  }

  @Post('plan-requests/:id/reject')
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.reject(user, id);
  }

  @Public()
  @Post('cashfree/webhook')
  webhook(@Req() req: any, @Body() body: any) {
    return this.billing.cashfreeWebhook(req.headers ?? {}, JSON.stringify(body ?? {}), body);
  }
}
