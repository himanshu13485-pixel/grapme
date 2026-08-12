import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Client-workspace setup reporting (onboarding process tracker). */
@Module({
  imports: [NotificationsModule],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
