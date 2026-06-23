import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DISPATCH,
  QUEUE_REPLIES,
  QUEUE_SEND,
  JOB_SCAN,
  JOB_POLL_REPLIES,
  JOB_SEND_EMAIL,
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
  ) {}

  async onModuleInit() {
    const scanEvery = this.config.get<number>('DISPATCH_SCAN_MS', 60_000);
    const pollEvery = this.config.get<number>('REPLY_POLL_MS', 300_000);

    await this.dispatchQueue.add(JOB_SCAN, {}, { repeat: { every: scanEvery } });
    await this.repliesQueue.add(
      JOB_POLL_REPLIES,
      {},
      { repeat: { every: pollEvery } },
    );
    this.logger.log(
      `Dispatcher every ${scanEvery}ms, reply poll every ${pollEvery}ms`,
    );
  }

  enqueueSend(job: SendEmailJob, delayMs: number) {
    return this.sendQueue.add(JOB_SEND_EMAIL, job, { delay: Math.max(0, delayMs) });
  }
}
