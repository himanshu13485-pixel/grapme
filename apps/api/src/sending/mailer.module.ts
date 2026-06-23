import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * Provides MailerService independently of the BullMQ queue, so the mailbox
 * connection test works even when the sending engine (Redis) is disabled.
 */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
