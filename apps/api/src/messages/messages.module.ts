import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { InboundMailService } from './inbound-mail.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { MailerModule } from '../sending/mailer.module';

@Module({
  imports: [ApprovalsModule, MailerModule],
  controllers: [MessagesController],
  providers: [MessagesService, InboundMailService],
  exports: [InboundMailService],
})
export class MessagesModule {}
