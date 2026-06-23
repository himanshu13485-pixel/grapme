import { Controller, Get } from '@nestjs/common';
import { MessagesService } from './messages.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('mailbox')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('sent')
  sent(@CurrentUser() user: AuthUser) {
    return this.messages.sent(user);
  }

  @Get('failed')
  failed(@CurrentUser() user: AuthUser) {
    return this.messages.failed(user);
  }

  @Get('scheduled')
  scheduled(@CurrentUser() user: AuthUser) {
    return this.messages.scheduled(user);
  }

  @Get('drafts')
  drafts(@CurrentUser() user: AuthUser) {
    return this.messages.drafts(user);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.messages.inbox(user);
  }
}
