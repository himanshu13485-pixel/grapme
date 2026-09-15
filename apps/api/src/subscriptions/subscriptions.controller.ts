import { Controller, Get, Param } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

/** Subscription renewal history — admins (any client in tenant) + clients (own). */
@Controller()
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER, Role.CLIENT)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('clients/:id/subscription-history')
  history(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.subs.historyForClient(u, id);
  }

  /** Field-by-field change history (staff only): old → new value, who, when. */
  @Get('clients/:id/change-history')
  changes(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.subs.changeHistoryForClient(u, id);
  }
}
