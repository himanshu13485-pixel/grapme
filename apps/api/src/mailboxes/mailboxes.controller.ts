import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
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

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller('email-accounts')
export class MailboxesController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.mailboxes.list(user, clientId);
  }

  /** Bounce-rate ceiling the auto-disable breaker uses (declared before the :id routes). */
  @Get('bounce-policy')
  bouncePolicy(@CurrentUser() user: AuthUser) {
    return this.mailboxes.getBouncePolicy(user);
  }

  @Patch('bounce-policy')
  setBouncePolicy(@CurrentUser() user: AuthUser, @Body() dto: { maxRatePct: number }) {
    return this.mailboxes.setBouncePolicy(user, dto.maxRatePct);
  }

  /** Staff: switch a disabled mailbox back on with a fresh bounce window. */
  @Post(':id/enable')
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.enable(user, id);
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

  /** Replicate a mailbox's configuration as a new PENDING mailbox (edit email + go live). */
  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mailboxes.duplicate(user, id);
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
