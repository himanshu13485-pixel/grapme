import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService, WhatsappSettings } from './notifications.service';

@Controller('notifications')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('whatsapp')
  getWhatsapp(@CurrentUser() user: AuthUser) {
    return this.notifications.getWhatsapp(user);
  }

  @Patch('whatsapp')
  setWhatsapp(@CurrentUser() user: AuthUser, @Body() dto: Partial<WhatsappSettings>) {
    return this.notifications.setWhatsapp(user, dto);
  }
}
