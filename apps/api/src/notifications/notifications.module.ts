import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotifyService } from './notify.service';
import { MailerService } from '../sending/mailer.service';

/** Tenant-level notification settings (WhatsApp sender config) + the shared
 *  NotifyService helper used by feature modules to fan out in-app / email /
 *  WhatsApp-stub alerts. PrismaModule is global; MailerService is stateless. */
@Module({
  providers: [NotificationsService, NotifyService, MailerService],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotifyService],
})
export class NotificationsModule {}
