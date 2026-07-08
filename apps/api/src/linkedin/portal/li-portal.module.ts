import { Module } from '@nestjs/common';
import { LinkedinModule } from '../linkedin.module';
import { ApprovalsModule } from '../../approvals/approvals.module';
import { LiPortalService } from './li-portal.service';
import { LiPortalController } from './li-portal.controller';

/**
 * Client-facing LinkedIn portal. Imports the LinkedIn services + Approvals so
 * clients can build campaigns and submit them for admin approval to launch.
 * Kept separate from LinkedinModule to avoid a circular import with Approvals.
 */
@Module({
  imports: [LinkedinModule, ApprovalsModule],
  providers: [LiPortalService],
  controllers: [LiPortalController],
})
export class LiPortalModule {}
