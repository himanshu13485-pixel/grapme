import { Module } from '@nestjs/common';
import { SendingService } from './sending.service';
import { MailerModule } from './mailer.module';
import { DispatchProcessor } from './dispatch.processor';
import { SendProcessor } from './send.processor';
import { RepliesProcessor } from './replies.processor';
import { EnrollProcessor } from './enroll.processor';
import { ProgramsModule } from '../programs/programs.module';
import { MessagesModule } from '../messages/messages.module';
import { ReportsModule } from '../reports/reports.module';
import { BounceModule } from '../bounce/bounce.module';
import { LinkedinModule } from '../linkedin/linkedin.module';
import { ReportingModule } from '../reporting/reporting.module';

/**
 * The queue-backed sending engine. Only imported when QUEUE_ENABLED !== 'false'
 * (see AppModule), so the rest of the app runs without Redis.
 */
@Module({
  imports: [MailerModule, ProgramsModule, MessagesModule, ReportsModule, BounceModule, LinkedinModule, ReportingModule],
  providers: [
    SendingService,
    DispatchProcessor,
    SendProcessor,
    RepliesProcessor,
    EnrollProcessor,
  ],
  exports: [SendingService],
})
export class SendingModule {}
