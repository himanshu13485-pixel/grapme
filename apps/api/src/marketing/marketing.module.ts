import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailerModule } from '../sending/mailer.module';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  imports: [MailerModule, JwtModule.register({})],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
