import { Global, Module } from '@nestjs/common';
import { ActivityService } from './services/activity.service';

@Global()
@Module({
  providers: [ActivityService],
  exports: [ActivityService],
})
export class CommonModule {}
