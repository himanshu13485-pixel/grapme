import { Global, Module } from '@nestjs/common';
import { ActivityService } from './services/activity.service';
import { GeoService } from './services/geo.service';

@Global()
@Module({
  providers: [ActivityService, GeoService],
  exports: [ActivityService, GeoService],
})
export class CommonModule {}
