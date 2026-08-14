import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProgramsService } from '../programs/programs.service';
import { ClientReportService } from '../reports/client-report.service';
import { BounceService } from '../bounce/bounce.service';
import { LiCampaignsService } from '../linkedin/campaigns/li-campaigns.service';
import { ReportingService } from '../reporting/reporting.service';
import {
  QUEUE_ENROLL,
  JOB_RUN_AUTO_COHORT,
  JOB_SEND_REPORTS,
  JOB_SETUP_NOTIFY,
} from '../queue/queue.constants';
import type { SetupNotifyJob } from '../reporting/reporting.service';

/**
 * Repeatable tick that drives the GRAPOUT cohort engine: every interval it
 * sends all enrollments whose next touch is due, rotating across each client's
 * mailbox group. Also runs the auto-cohort and client-report sweeps. The
 * schedules themselves are registered in SendingService.
 */
@Processor(QUEUE_ENROLL)
export class EnrollProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrollProcessor.name);

  constructor(
    private programs: ProgramsService,
    private clientReports: ClientReportService,
    private bounce: BounceService,
    private liCampaigns: LiCampaignsService,
    private reporting: ReportingService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_SETUP_NOTIFY) {
      await this.reporting.sendReminderChannel(job.data as SetupNotifyJob);
    } else if (job.name === JOB_RUN_AUTO_COHORT) {
      await this.programs.runAutoCohorts();
    } else if (job.name === JOB_SEND_REPORTS) {
      await this.clientReports.runDueReports();
      // Piggyback the hourly sweep: auto-disable mailboxes bouncing too hard,
      // permanently purge LinkedIn campaigns soft-deleted more than 30 days ago, and
      // nudge assignees about pending monthly email-arrangement work.
      await this.bounce.checkBounceRates();
      await this.liCampaigns.purgeExpiredDeleted();
      await this.reporting.runSetupReminders().catch(() => undefined);
    } else {
      await this.programs.runDueNow();
    }
  }
}
