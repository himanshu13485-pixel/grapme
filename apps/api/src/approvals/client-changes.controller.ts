import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApprovalsService } from './approvals.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/**
 * What is waiting for review in one workspace — the client portal's
 * "Awaiting approval" panel. A client-portal user only sees their own
 * workspaces (enforced in the service).
 */
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.CLIENT)
@Controller('client-changes')
export class ClientChangesController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthUser, @Query('clientId') clientId: string) {
    return this.approvals.pendingForClient(user, clientId);
  }
}
