import { Module } from '@nestjs/common';
import { SubAdminsService } from './sub-admins.service';
import { SubAdminsController } from './sub-admins.controller';

@Module({
  controllers: [SubAdminsController],
  providers: [SubAdminsService],
  exports: [SubAdminsService],
})
export class SubAdminsModule {}
