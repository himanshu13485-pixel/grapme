import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  CampaignStatus,
  ContactStatus,
  EventType,
  MessageStatus,
  StepCondition,
  TemplateStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { renderTemplate } from '../templates/templates.service';
import { instrumentHtml } from './tracking.util';
import { QUEUE_SEND, JOB_RESEND_MESSAGE } from '../queue/queue.constants';
import { SendEmailJob } from './sending.service';
import { BounceService } from '../bounce/bounce.service';
import { MessagesService } from '../messages/messages.service';

@Processor(QUEUE_SEND, { concurrency: 5 })
export class SendProcessor extends WorkerHost {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
    private bounce: BounceService,
    private messages: MessagesService,
    @InjectQueue(QUEUE_SEND) private sendQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<SendEmailJob & { messageId?: string }>): Promise<void> {
    // Background resend of a previously-FAILED email (from the Failed tab "Resend all").
    if (job.name === JOB_RESEND_MESSAGE) {
      await this.messages.resendById(String((job.data as { messageId?: string }).messageId)).catch((e) => this.logger.warn(`resend ${(job.data as { messageId?: string }).messageId} failed: ${e}`));
      return;
    }
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

    // Email credit metering: each send costs 1 credit from the client's balance.
    // When metering is on and the balance is empty, hold the send (retry later)
    // so it goes out once the admin tops the client up.
    if (campaign.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: campaign.clientId },
        select: { emailCreditMetering: true, emailCredits: true },
      });
      if (client?.emailCreditMetering && client.emailCredits < 1) {
        throw new Error('Out of email credits — retry later');
      }
    }

    // Follow-up guards: a reply always stops the sequence, then the step's
    // own condition (NO_REPLY / OPENED / NOT_OPENED) decides whether to send.
    if (stepId) {
      // 1. A reply always halts the sequence, regardless of the step condition.
      const replied = await this.prisma.emailEvent.findFirst({
        where: {
          campaignId,
          eventType: EventType.REPLY,
          message: { contactId },
        },
      });
      if (replied) {
        this.logger.log(`Skipping follow-up for ${contact.email} (replied)`);
        await this.maybeComplete(campaignId, job.id);
        return;
      }

      // 2. Evaluate the step's open-based condition against prior touches.
      const step = await this.prisma.campaignStep.findUnique({
        where: { id: stepId },
      });
      const condition = step?.condition ?? StepCondition.ALWAYS;
      if (
        condition === StepCondition.OPENED ||
        condition === StepCondition.NOT_OPENED
      ) {
        const opened = await this.prisma.emailEvent.findFirst({
          where: {
            campaignId,
            eventType: EventType.OPEN,
            message: { contactId },
          },
        });
        if (condition === StepCondition.OPENED && !opened) {
          this.logger.log(
            `Skipping follow-up for ${contact.email} (condition OPENED, none opened)`,
          );
          await this.maybeComplete(campaignId, job.id);
          return;
        }
        if (condition === StepCondition.NOT_OPENED && opened) {
          this.logger.log(
            `Skipping follow-up for ${contact.email} (condition NOT_OPENED, was opened)`,
          );
          await this.maybeComplete(campaignId, job.id);
          return;
        }
      }
      // NO_REPLY / ALWAYS: the reply check above already covers NO_REPLY.
    }

    const template = await this.prisma.emailTemplate.findFirst({
      where: { id: templateId, status: TemplateStatus.APPROVED },
    });
    if (!template) {
      // Missing, or not approved (e.g. a client rewrote it after the campaign
      // was approved and it's back in review). Never send unreviewed content.
      this.logger.warn(
        `Not sending to ${contact.email}: template ${templateId} is missing or not approved`,
      );
      return;
    }

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
      // Debit 1 email credit for the send (atomic; only when metering is on).
      if (campaign.clientId) {
        await this.prisma.client.updateMany({
          where: { id: campaign.clientId, emailCreditMetering: true, emailCredits: { gte: 1 } },
          data: { emailCredits: { decrement: 1 } },
        });
      }

      await this.maybeComplete(campaignId, job.id);
    } catch (err) {
      // Permanent (hard) SMTP rejection → suppress the recipient now instead of
      // blindly retrying a dead address (which tanks sender reputation).
      if (this.bounce.isHardSmtpError(err)) {
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: MessageStatus.BOUNCED, error: String(err) },
        });
        await this.bounce.recordHardBounce(campaign.tenantId, contact.email, { messageId: message.id, campaignId, reason: String((err as Error)?.message || err) });
        return; // don't retry a permanent failure
      }
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: MessageStatus.FAILED, error: String(err) },
      });
      throw err; // transient → let BullMQ retry with backoff
    }
  }

  /**
   * Marks the campaign COMPLETED only when nothing is left to send — both
   * in-flight message rows AND scheduled follow-up jobs still sitting in the
   * send queue (initial + follow-ups are enqueued up-front as delayed jobs,
   * so counting QUEUED message rows alone completes the campaign too early
   * and the status flip then silently drops every pending follow-up).
   */
  private async maybeComplete(campaignId: string, currentJobId?: string) {
    const pendingRows = await this.prisma.emailMessage.count({
      where: { campaignId, status: MessageStatus.QUEUED },
    });
    if (pendingRows > 0) return;

    // Any follow-up sends for this campaign still waiting/delayed/active?
    const jobs = await this.sendQueue.getJobs([
      'delayed',
      'waiting',
      'active',
      'paused',
    ]);
    const hasPending = jobs.some(
      (j) =>
        j &&
        (j.data as SendEmailJob)?.campaignId === campaignId &&
        String(j.id) !== String(currentJobId),
    );
    if (hasPending) return;

    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: CampaignStatus.RUNNING },
      data: { status: CampaignStatus.COMPLETED },
    });
  }
}
