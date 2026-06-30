import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ClientReportService } from './client-report.service';
import { ReportsController } from './reports.controller';
import { MailerModule } from '../sending/mailer.module';

@Module({
  imports: [MailerModule],
  controllers: [ReportsController],
  providers: [ReportsService, ClientReportService],
  exports: [ClientReportService],
})
export class ReportsModule {}
