import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  CampaignStatus,
  ContactStatus,
  ScheduleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SendingService } from './sending.service';
import { QUEUE_DISPATCH } from '../queue/queue.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs on a repeat. Picks up campaigns whose schedule is APPROVED and due,
 * then enqueues an initial send + each follow-up step per eligible contact.
 */
@Processor(QUEUE_DISPATCH)
export class DispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    private prisma: PrismaService,
    private sending: SendingService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const due = await this.prisma.schedule.findMany({
      where: {
        status: ScheduleStatus.APPROVED,
        scheduledAt: { lte: new Date() },
        campaign: { status: CampaignStatus.SCHEDULED },
      },
      include: {
        campaign: { include: { steps: { orderBy: { stepOrder: 'asc' } }, client: true } },
      },
    });

    for (const schedule of due) {
      await this.dispatchCampaign(schedule.id, schedule.campaign);
    }
  }

  private async dispatchCampaign(scheduleId: string, campaign: any) {
    if (!campaign.listId || !campaign.templateId) return;

    // Eligible contacts: active, in the list, not suppressed.
    const members = await this.prisma.contactListMember.findMany({
      where: { listId: campaign.listId },
      include: { contact: true },
    });
    const suppressed = new Set(
      (
        await this.prisma.suppression.findMany({
          where: { tenantId: campaign.tenantId },
          select: { email: true },
        })
      ).map((s) => s.email.toLowerCase()),
    );

    const contacts = members
      .map((m) => m.contact)
      .filter(
        (c) =>
          c.status === ContactStatus.ACTIVE &&
          !suppressed.has(c.email.toLowerCase()),
      )
      .slice(0, campaign.dailyLimit); // warm-up: cap per dispatch

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.RUNNING },
    });
    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: { status: ScheduleStatus.QUEUED },
    });

    const spacing = campaign.sendSpeedSeconds * 1000;
    // Per-client random stagger so a batch doesn't fire at identical instants.
    const jitterMax = Math.max(0, (campaign.client?.emailJitterSeconds ?? 20)) * 1000;
    contacts.forEach((contact, i) => {
      const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
      const base = i * spacing + jitter;

      // Initial email.
      void this.sending.enqueueSend(
        {
          campaignId: campaign.id,
          contactId: contact.id,
          stepId: null,
          templateId: campaign.templateId,
        },
        base,
      );

      // Follow-up steps, offset by cumulative wait days.
      let cumulativeDays = 0;
      for (const step of campaign.steps) {
        cumulativeDays += step.waitDays;
        void this.sending.enqueueSend(
          {
            campaignId: campaign.id,
            contactId: contact.id,
            stepId: step.id,
            templateId: step.templateId ?? campaign.templateId,
          },
          base + cumulativeDays * DAY_MS,
        );
      }
    });

    this.logger.log(
      `Dispatched campaign ${campaign.id}: ${contacts.length} contacts, ${campaign.steps.length} follow-up steps`,
    );
  }
}
