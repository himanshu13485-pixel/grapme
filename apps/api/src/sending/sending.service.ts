import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DISPATCH,
  QUEUE_REPLIES,
  QUEUE_SEND,
  QUEUE_ENROLL,
  JOB_SCAN,
  JOB_POLL_REPLIES,
  JOB_SEND_EMAIL,
  JOB_RUN_ENROLL,
  JOB_RUN_AUTO_COHORT,
  JOB_SEND_REPORTS,
} from '../queue/queue.constants';

export interface SendEmailJob {
  campaignId: string;
  contactId: string;
  stepId: string | null;
  templateId: string;
}

/**
 * Owns the repeatable "scan" (find due schedules) and "poll" (IMAP replies)
 * jobs, and exposes a helper to enqueue an individual send.
 */
@Injectable()
export class SendingService implements OnModuleInit {
  private readonly logger = new Logger(SendingService.name);

  constructor(
    private config: ConfigService,
    @InjectQueue(QUEUE_DISPATCH) private dispatchQueue: Queue,
    @InjectQueue(QUEUE_SEND) private sendQueue: Queue,
    @InjectQueue(QUEUE_REPLIES) private repliesQueue: Queue,
    @InjectQueue(QUEUE_ENROLL) private enrollQueue: Queue,
  ) {}

  async onModuleInit() {
    const scanEvery = this.config.get<number>('DISPATCH_SCAN_MS', 60_000);
    const pollEvery = this.config.get<number>('REPLY_POLL_MS', 300_000);
    const enrollEvery = this.config.get<number>('ENROLL_SCAN_MS', 60_000);

    await this.dispatchQueue.add(JOB_SCAN, {}, { repeat: { every: scanEvery } });
    await this.repliesQueue.add(
      JOB_POLL_REPLIES,
      {},
      { repeat: { every: pollEvery } },
    );
    await this.enrollQueue.add(
      JOB_RUN_ENROLL,
      {},
      { repeat: { every: enrollEvery } },
    );
    const autoCohortEvery = this.config.get<number>(
      'AUTO_COHORT_SCAN_MS',
      3_600_000, // hourly check; idempotent (once per client per month)
    );
    await this.enrollQueue.add(
      JOB_RUN_AUTO_COHORT,
      {},
      { repeat: { every: autoCohortEvery } },
    );
    // Client email reports: sweep hourly; the service decides what's due.
    const reportEvery = this.config.get<number>('REPORT_SCAN_MS', 3_600_000);
    await this.enrollQueue.add(
      JOB_SEND_REPORTS,
      {},
      { repeat: { every: reportEvery } },
    );
    this.logger.log(
      `Dispatcher every ${scanEvery}ms, reply poll every ${pollEvery}ms, cohort engine every ${enrollEvery}ms, auto-cohort every ${autoCohortEvery}ms, reports every ${reportEvery}ms`,
    );
  }

  enqueueSend(job: SendEmailJob, delayMs: number) {
    return this.sendQueue.add(JOB_SEND_EMAIL, job, { delay: Math.max(0, delayMs) });
  }
}
