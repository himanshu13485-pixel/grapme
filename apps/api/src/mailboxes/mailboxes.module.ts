import { Module } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { SendingModule } from '../sending/sending.module';

@Module({
  imports: [ApprovalsModule, SendingModule],
  controllers: [MailboxesController],
  providers: [MailboxesService],
  exports: [MailboxesService],
})
export class MailboxesModule {}
