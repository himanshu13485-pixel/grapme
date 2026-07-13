import { Module } from '@nestjs/common';
import { MailerService } from '../sending/mailer.service';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';

/** Work / Meetings / Notification board (two-way admin ↔ client threads + bell).
 *  PrismaModule is global, so it needn't be imported here. */
@Module({
  controllers: [UpdatesController],
  // MailerService is stateless (builds per-mailbox SMTP transports on demand),
  // so we can provide it directly instead of importing the sending module.
  providers: [UpdatesService, MailerService],
})
export class UpdatesModule {}
