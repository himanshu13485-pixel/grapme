import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Client Support: tickets, two-way chat, attachments, routing + escalation.
 *  Imports NotificationsModule for the shared NotifyService (in-app / email /
 *  WhatsApp-stub fan-out). PrismaModule is global. */
@Module({
  imports: [NotificationsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
