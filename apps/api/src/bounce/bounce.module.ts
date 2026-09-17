import { Module } from '@nestjs/common';
import { BounceService } from './bounce.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Shared bounce handling (SMTP-time hard failures, DSN recording, circuit breaker). */
@Module({
  imports: [NotificationsModule],
  providers: [BounceService],
  exports: [BounceService],
})
export class BounceModule {}
