import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { InboundMailService } from './inbound-mail.service';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ApprovalsModule],
  controllers: [MessagesController],
  providers: [MessagesService, InboundMailService],
  exports: [InboundMailService],
})
export class MessagesModule {}
