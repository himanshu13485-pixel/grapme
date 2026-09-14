import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityService } from './services/activity.service';
import { GeoService } from './services/geo.service';
import { ActivityAuditInterceptor } from './interceptors/activity-audit.interceptor';

@Global()
@Module({
  providers: [
    ActivityService,
    GeoService,
    // Every authenticated write reaches the activity log (see the interceptor).
    { provide: APP_INTERCEPTOR, useClass: ActivityAuditInterceptor },
  ],
  exports: [ActivityService, GeoService],
})
export class CommonModule {}
