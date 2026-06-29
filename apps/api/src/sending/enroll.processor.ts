import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProgramsService } from '../programs/programs.service';
import { QUEUE_ENROLL, JOB_RUN_AUTO_COHORT } from '../queue/queue.constants';

/**
 * Repeatable tick that drives the GRAPOUT cohort engine: every interval it
 * sends all enrollments whose next touch is due, rotating across each client's
 * mailbox group. The schedule itself is registered in SendingService.
 */
@Processor(QUEUE_ENROLL)
export class EnrollProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrollProcessor.name);

  constructor(private programs: ProgramsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_RUN_AUTO_COHORT) {
      await this.programs.runAutoCohorts();
    } else {
      await this.programs.runDueNow();
    }
  }
}
