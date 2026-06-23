import { Module } from '@nestjs/common';
import { SendingService } from './sending.service';
import { MailerModule } from './mailer.module';
import { DispatchProcessor } from './dispatch.processor';
import { SendProcessor } from './send.processor';
import { RepliesProcessor } from './replies.processor';

/**
 * The queue-backed sending engine. Only imported when QUEUE_ENABLED !== 'false'
 * (see AppModule), so the rest of the app runs without Redis.
 */
@Module({
  imports: [MailerModule],
  providers: [
    SendingService,
    DispatchProcessor,
    SendProcessor,
    RepliesProcessor,
  ],
  exports: [SendingService],
})
export class SendingModule {}
