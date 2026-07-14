import { Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { SessionsService } from './sessions.service';

/** Admin: live client logins + force-logout. */
@Controller('admin')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Clients currently signed in (active within the idle window). */
  @Get('live-clients')
  liveClients(@CurrentUser() u: AuthUser) {
    return this.sessions.liveClients(u);
  }

  /** Sign a client out of every session (by owned client profile). */
  @HttpCode(200)
  @Post('clients/:id/logout')
  logoutClient(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.sessions.logoutClient(u, id);
  }

  /** Sign a client login out of every session (by login user id). */
  @HttpCode(200)
  @Post('client-logins/:userId/logout')
  logoutUser(@CurrentUser() u: AuthUser, @Param('userId') userId: string) {
    return this.sessions.logoutUser(u, userId);
  }
}
