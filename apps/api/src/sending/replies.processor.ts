import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_REPLIES } from '../queue/queue.constants';
import { InboundMailService } from '../messages/inbound-mail.service';

/**
 * Repeatable worker: pulls recent inbound mail from every active IMAP mailbox
 * and records replies. The actual IMAP/store logic lives in InboundMailService
 * so the on-demand "Sync now" button shares the exact same behaviour.
 */
@Processor(QUEUE_REPLIES)
export class RepliesProcessor extends WorkerHost {
  constructor(private readonly inbound: InboundMailService) {
    super();
  }

  async process(): Promise<void> {
    await this.inbound.syncAll(1);
  }
}
