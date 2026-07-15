import { Module } from '@nestjs/common';
import { MailerModule } from '../sending/mailer.module';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  imports: [MailerModule],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
