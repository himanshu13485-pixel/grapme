import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotifyService } from './notify.service';
import { WhatsappOtpService } from './whatsapp-otp.service';
import { WhatsappPortalService } from './whatsapp-portal.service';
import { WhatsappVerifyController } from './whatsapp-verify.controller';
import { MailerService } from '../sending/mailer.service';

/** Tenant-level notification settings + the shared NotifyService helper used by
 *  feature modules to fan out in-app / email / WhatsApp alerts, plus WhatsApp
 *  number verification (OTP). PrismaModule is global; MailerService is stateless. */
@Module({
  providers: [
    NotificationsService,
    NotifyService,
    WhatsappPortalService,
    WhatsappOtpService,
    MailerService,
  ],
  controllers: [NotificationsController, WhatsappVerifyController],
  exports: [NotificationsService, NotifyService, WhatsappPortalService, WhatsappOtpService],
})
export class NotificationsModule {}
