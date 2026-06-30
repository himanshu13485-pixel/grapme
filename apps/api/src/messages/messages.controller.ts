import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { InboundMailService } from './inbound-mail.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('mailbox')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly inbound: InboundMailService,
  ) {}

  /** On-demand pull from IMAP — fetches new replies right now (no waiting for
   *  the background poll), optionally scoped to one client's mailboxes. */
  @HttpCode(200)
  @Post('sync')
  sync(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.inbound.syncTenant(user.tenantId, clientId);
  }

  @Get('sent')
  sent(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.sent(user, clientId);
  }

  @Get('failed')
  failed(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.failed(user, clientId);
  }

  @Get('scheduled')
  scheduled(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.scheduled(user, clientId);
  }

  @Get('drafts')
  drafts(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.drafts(user, clientId);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.inbox(user, clientId);
  }
}
