import { Module } from '@nestjs/common';
import { DeliverabilityService } from './deliverability.service';
import { DeliverabilityController } from './deliverability.controller';

@Module({
  controllers: [DeliverabilityController],
  providers: [DeliverabilityService],
})
export class DeliverabilityModule {}
