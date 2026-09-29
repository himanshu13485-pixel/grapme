import { Module } from '@nestjs/common';
import { ReplyBoostController } from './reply-boost.controller';

/** The service itself lives in the global CommonModule (dashboards use it too). */
@Module({
  controllers: [ReplyBoostController],
})
export class ReplyBoostModule {}
