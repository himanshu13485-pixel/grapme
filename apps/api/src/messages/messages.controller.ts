import { Controller, Get, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('mailbox')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

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
