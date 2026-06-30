import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import {
  CreateMailboxDto,
  SendTestEmailDto,
  UpdateMailboxDto,
} from './dto/mailboxes.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('email-accounts')
export class MailboxesController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.mailboxes.list(user, clientId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMailboxDto) {
    return this.mailboxes.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMailboxDto,
  ) {
    return this.mailboxes.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.remove(user, id);
  }

  @HttpCode(200)
  @Post(':id/test')
  test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.testConnection(user, id);
  }

  @HttpCode(200)
  @Post(':id/test-imap')
  testImap(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.testImap(user, id);
  }

  @HttpCode(200)
  @Post(':id/test-email')
  sendTest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendTestEmailDto,
  ) {
    return this.mailboxes.sendTest(user, id, dto);
  }
}
