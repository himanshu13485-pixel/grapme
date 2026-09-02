import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ChannelSettingsDto, NotificationsService } from './notifications.service';
import { MessagingChannel, parseChannel } from './channels';

@Controller('notifications')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Every messaging channel's settings at once. */
  @Get('channels')
  getAll(@CurrentUser() user: AuthUser) {
    return this.notifications.getAll(user);
  }

  @Get('channels/:channel')
  get(@CurrentUser() user: AuthUser, @Param('channel') channel: string) {
    return this.notifications.get(user, this.channel(channel));
  }

  @Patch('channels/:channel')
  set(
    @CurrentUser() user: AuthUser,
    @Param('channel') channel: string,
    @Body() dto: Partial<ChannelSettingsDto>,
  ) {
    return this.notifications.set(user, this.channel(channel), dto);
  }

  /** Check the saved credentials against the portal without sending a message. */
  @Post('channels/:channel/test')
  test(@CurrentUser() user: AuthUser, @Param('channel') channel: string) {
    return this.notifications.test(user, this.channel(channel));
  }

  /** Actually send one, to the admin who asked. The end-to-end check. */
  @Post('channels/:channel/test-message')
  sendTest(@CurrentUser() user: AuthUser, @Param('channel') channel: string) {
    return this.notifications.sendTest(user, this.channel(channel));
  }

  // -- the WhatsApp-only routes these replaced -----------------------------
  // Kept so a browser still running the previous build keeps working across a
  // deploy. @deprecated — use /notifications/channels/:channel.

  @Get('whatsapp')
  getWhatsapp(@CurrentUser() user: AuthUser) {
    return this.notifications.get(user, 'whatsapp');
  }

  @Patch('whatsapp')
  setWhatsapp(@CurrentUser() user: AuthUser, @Body() dto: Partial<ChannelSettingsDto>) {
    return this.notifications.set(user, 'whatsapp', dto);
  }

  @Post('whatsapp/test')
  testWhatsapp(@CurrentUser() user: AuthUser) {
    return this.notifications.test(user, 'whatsapp');
  }

  private channel(value: string): MessagingChannel {
    const channel = parseChannel(value);
    if (!channel) throw new BadRequestException('Unknown messaging channel.');

    return channel;
  }
}
