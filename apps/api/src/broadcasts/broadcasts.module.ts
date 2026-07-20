import { Module } from '@nestjs/common';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Admin one-way broadcasts → client portal "Notification" page (+ bell/email/WhatsApp).
 *  Imports NotificationsModule for the shared NotifyService fan-out. */
@Module({
  imports: [NotificationsModule],
  controllers: [BroadcastsController],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}
