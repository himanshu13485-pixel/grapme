import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import {
  Body,
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

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
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
  async sync(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.inbound.syncTenant(user.tenantId, await this.messages.ownClientParam(user, clientId));
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
  sent(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('mailbox') mailbox?: string) {
    return this.messages.sent(user, clientId, mailbox);
  }

  @Get('failed')
  failed(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('mailbox') mailbox?: string) {
    return this.messages.failed(user, clientId, mailbox);
  }

  @Get('scheduled')
  scheduled(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('mailbox') mailbox?: string) {
    return this.messages.scheduled(user, clientId, mailbox);
  }

  @Get('drafts')
  drafts(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('mailbox') mailbox?: string) {
    return this.messages.drafts(user, clientId, mailbox);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('mailbox') mailbox?: string) {
    return this.messages.inbox(user, clientId, mailbox);
  }

  /** Re-send one failed email. */
  @Post(':id/resend')
  resend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.resend(user, id);
  }

  /** Re-send up to 25 failed emails (scoped to a client if given). */
  @Post('resend-failed')
  resendFailed(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.messages.resendFailed(user, clientId);
  }

  /** Bulk-delete selected messages (super admin only). */
  @Post('bulk-delete')
  removeMany(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.messages.removeMany(user, body.ids ?? []);
  }

  /** Delete a single message from any folder (its events cascade). */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.remove(user, id);
  }
}
