import { Module } from '@nestjs/common';
import { InternalWorkController } from './internal-work.controller';
import { InternalWorkService } from './internal-work.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Internal Work: the agency's private notes / discussion board (admin-only).
 *  Imports NotificationsModule for the shared NotifyService fan-out. */
@Module({
  imports: [NotificationsModule],
  controllers: [InternalWorkController],
  providers: [InternalWorkService],
  exports: [InternalWorkService],
})
export class InternalWorkModule {}
