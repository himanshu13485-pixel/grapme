import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ClientChangesController } from './client-changes.controller';
import { LinkedinModule } from '../linkedin/linkedin.module';

@Module({
  imports: [LinkedinModule], // to launch a LinkedIn campaign on approval
  controllers: [ApprovalsController, ClientChangesController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
