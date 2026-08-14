import { Module } from '@nestjs/common';
import { DuplicateEmailsService } from './duplicate-emails.service';
import { DuplicateEmailsController } from './duplicate-emails.controller';

@Module({
  controllers: [DuplicateEmailsController],
  providers: [DuplicateEmailsService],
})
export class DuplicateEmailsModule {}
