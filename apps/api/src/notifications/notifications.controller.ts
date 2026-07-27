import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService, WhatsappSettingsDto } from './notifications.service';

@Controller('notifications')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('whatsapp')
  getWhatsapp(@CurrentUser() user: AuthUser) {
    return this.notifications.getWhatsapp(user);
  }

  @Patch('whatsapp')
  setWhatsapp(@CurrentUser() user: AuthUser, @Body() dto: Partial<WhatsappSettingsDto>) {
    return this.notifications.setWhatsapp(user, dto);
  }

  /** Check the saved credentials against the portal without sending a message. */
  @Post('whatsapp/test')
  testWhatsapp(@CurrentUser() user: AuthUser) {
    return this.notifications.testWhatsapp(user);
  }
}
