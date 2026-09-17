import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotifyService } from './notify.service';
import { AdminAlertsService } from './admin-alerts.service';
import { OtpService } from './otp.service';
import { PortalService } from './portal.service';
import { VerifyController } from './verify.controller';
import { WhatsappVerifyController } from './whatsapp-verify.controller';
import { MailerService } from '../sending/mailer.service';

/** Tenant-level notification settings + the shared NotifyService helper used by
 *  feature modules to fan out in-app / email / WhatsApp / Telegram alerts, plus
 *  number verification (OTP) on either messaging channel. PrismaModule is
 *  global; MailerService is stateless. */
@Module({
  providers: [
    NotificationsService,
    NotifyService,
    AdminAlertsService,
    PortalService,
    OtpService,
    MailerService,
  ],
  controllers: [NotificationsController, VerifyController, WhatsappVerifyController],
  exports: [NotificationsService, NotifyService, AdminAlertsService, PortalService, OtpService],
})
export class NotificationsModule {}
