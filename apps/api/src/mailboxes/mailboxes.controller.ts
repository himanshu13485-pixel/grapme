import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { CreateMailboxDto } from './dto/mailboxes.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('email-accounts')
export class MailboxesController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.mailboxes.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMailboxDto) {
    return this.mailboxes.create(user, dto);
  }

  @HttpCode(200)
  @Post(':id/test')
  test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.testConnection(user, id);
  }
}
