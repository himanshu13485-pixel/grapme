import { Module } from '@nestjs/common';
import { SendingService } from './sending.service';
import { MailerService } from './mailer.service';
import { DispatchProcessor } from './dispatch.processor';
import { SendProcessor } from './send.processor';
import { RepliesProcessor } from './replies.processor';

@Module({
  providers: [
    SendingService,
    MailerService,
    DispatchProcessor,
    SendProcessor,
    RepliesProcessor,
  ],
  exports: [SendingService, MailerService],
})
export class SendingModule {}
