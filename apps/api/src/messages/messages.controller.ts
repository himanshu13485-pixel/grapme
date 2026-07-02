import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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

  /** Unread inbound count for the Inbox badge / new-mail alert. */
  @Get('unread')
  unread(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.unreadCount(user, clientId);
  }

  /** Mark inbound replies read (clears the badge once the Inbox is viewed). */
  @HttpCode(200)
  @Post('mark-read')
  markRead(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.markRead(user, clientId);
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

  /** Delete a single message from any folder (its events cascade). */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.remove(user, id);
  }
}
