import { Module } from '@nestjs/common';
import { BounceService } from './bounce.service';

/** Shared bounce handling (SMTP-time hard failures, DSN recording, circuit breaker). */
@Module({
  providers: [BounceService],
  exports: [BounceService],
})
export class BounceModule {}
