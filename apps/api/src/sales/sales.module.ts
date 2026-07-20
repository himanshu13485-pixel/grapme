import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { MailerService } from '../sending/mailer.service';

/** Sales Person management + the salesperson's scoped read-only panel.
 *  PrismaModule + CommonModule (ActivityService) are global; MailerService is
 *  stateless so we provide it directly for the transactional welcome email. */
@Module({
  controllers: [SalesController],
  providers: [SalesService, MailerService],
  exports: [SalesService],
})
export class SalesModule {}
