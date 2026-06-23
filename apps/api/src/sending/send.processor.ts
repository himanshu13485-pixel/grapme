import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  CampaignStatus,
  ContactStatus,
  EventType,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { renderTemplate } from '../templates/templates.service';
import { instrumentHtml } from './tracking.util';
import { QUEUE_SEND } from '../queue/queue.constants';
import { SendEmailJob } from './sending.service';

@Processor(QUEUE_SEND, { concurrency: 5 })
export class SendProcessor extends WorkerHost {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<SendEmailJob>): Promise<void> {
    const { campaignId, contactId, stepId, templateId } = job.data;

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { emailAccount: true },
    });
    if (!campaign || !campaign.emailAccount) return;

    // Respect lifecycle: pause means try again later; completed/rejected = drop.
    if (campaign.status === CampaignStatus.PAUSED) {
      throw new Error('Campaign paused — retry later');
    }
    if (
      campaign.status !== CampaignStatus.RUNNING &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      return;
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact || contact.status !== ContactStatus.ACTIVE) return;

    // Follow-up guard: if the contact already replied, stop the sequence.
    if (stepId) {
      const replied = await this.prisma.emailEvent.findFirst({
        where: {
          campaignId,
          eventType: EventType.REPLY,
          message: { contactId },
        },
      });
      if (replied) {
        this.logger.log(`Skipping follow-up for ${contact.email} (replied)`);
        return;
      }
    }

    const template = await this.prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) return;

    const data = {
      name: contact.firstName ?? '',
      first_name: contact.firstName ?? '',
      last_name: contact.lastName ?? '',
      company: contact.company ?? '',
      country: contact.country ?? '',
      email: contact.email,
      ...(contact.customFields as Record<string, unknown>),
    };
    const subject = renderTemplate(template.subject, data);
    const renderedBody = renderTemplate(template.bodyHtml, data);

    // Create the message row first so tracking links can reference its id.
    const message = await this.prisma.emailMessage.create({
      data: {
        tenantId: campaign.tenantId,
        campaignId,
        stepId,
        contactId,
        emailAccountId: campaign.emailAccountId,
        direction: 'OUTBOUND',
        subject,
        status: MessageStatus.QUEUED,
      },
    });

    const publicBase = this.config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:4000',
    );
    const html = instrumentHtml(renderedBody, publicBase, message.id);

    try {
      const result = await this.mailer.send({
        account: campaign.emailAccount,
        to: contact.email,
        subject,
        html,
        headers: { 'X-AEO-Message': message.id },
      });

      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.SENT,
          messageId: result.messageId,
          sentAt: new Date(),
        },
      });
      await this.prisma.emailEvent.create({
        data: { messageId: message.id, campaignId, eventType: EventType.SENT },
      });

      await this.maybeComplete(campaignId);
    } catch (err) {
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: MessageStatus.FAILED, error: String(err) },
      });
      throw err; // let BullMQ retry with backoff
    }
  }

  /** Marks the campaign COMPLETED once nothing is left queued. */
  private async maybeComplete(campaignId: string) {
    const pending = await this.prisma.emailMessage.count({
      where: { campaignId, status: MessageStatus.QUEUED },
    });
    if (pending === 0) {
      await this.prisma.campaign.updateMany({
        where: { id: campaignId, status: CampaignStatus.RUNNING },
        data: { status: CampaignStatus.COMPLETED },
      });
    }
  }
}
