import { Module } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { MailerModule } from '../sending/mailer.module';

@Module({
  imports: [ApprovalsModule, MailerModule],
  controllers: [MailboxesController],
  providers: [MailboxesService],
  exports: [MailboxesService],
})
export class MailboxesModule {}
