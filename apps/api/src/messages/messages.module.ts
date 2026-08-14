import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { InboundMailService } from './inbound-mail.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { MailerModule } from '../sending/mailer.module';
import { BounceModule } from '../bounce/bounce.module';

@Module({
  imports: [ApprovalsModule, MailerModule, BounceModule],
  controllers: [MessagesController],
  providers: [MessagesService, InboundMailService],
  exports: [InboundMailService, MessagesService],
})
export class MessagesModule {}
