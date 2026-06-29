import { Module } from '@nestjs/common';
import { ProgramsService } from './programs.service';
import { ProgramsController } from './programs.controller';
import { MailerModule } from '../sending/mailer.module';

/**
 * GRAPOUT cohort engine: clients, mailbox groups, sequences, and monthly
 * cohort enrollment. Always loaded (CRUD works without Redis); the repeatable
 * drip tick lives in SendingModule and is only active when the engine is on.
 */
@Module({
  imports: [MailerModule],
  providers: [ProgramsService],
  controllers: [ProgramsController],
  exports: [ProgramsService],
})
export class ProgramsModule {}
