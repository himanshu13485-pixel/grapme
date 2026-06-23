import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApprovalEntity,
  CampaignStatus,
  EventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AddStepDto,
  ScheduleCampaignDto,
} from './dto/campaigns.dto';

// States in which a user may still edit campaign content.
const EDITABLE: CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.REJECTED,
];

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private activity: ActivityService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.campaign.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { steps: true, messages: true } } },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, schedules: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  create(user: AuthUser, dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        clientLabel: dto.clientLabel,
        emailAccountId: dto.emailAccountId,
        listId: dto.listId,
        templateId: dto.templateId,
        timezone: dto.timezone ?? 'UTC',
        dailyLimit: dto.dailyLimit ?? 200,
        sendSpeedSeconds: dto.sendSpeedSeconds ?? 90,
        status: CampaignStatus.DRAFT,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateCampaignDto) {
    const campaign = await this.getOne(user, id);
    this.assertEditable(campaign.status);
    return this.prisma.campaign.update({ where: { id }, data: { ...dto } });
  }

  async addStep(user: AuthUser, id: string, dto: AddStepDto) {
    const campaign = await this.getOne(user, id);
    this.assertEditable(campaign.status);
    return this.prisma.campaignStep.create({
      data: {
        campaignId: id,
        stepOrder: dto.stepOrder,
        templateId: dto.templateId,
        waitDays: dto.waitDays,
        condition: dto.condition ?? 'ALWAYS',
      },
    });
  }

  /** Submit campaign for admin approval — the core gate. */
  async submit(user: AuthUser, id: string) {
    const campaign = await this.getOne(user, id);
    this.assertEditable(campaign.status);
    if (!campaign.emailAccountId || !campaign.listId || !campaign.templateId) {
      throw new BadRequestException(
        'Campaign needs a mailbox, contact list, and template before submission.',
      );
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.PENDING },
    });
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.CAMPAIGN,
      entityId: id,
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'SUBMIT_CAMPAIGN',
      entityType: 'Campaign',
      entityId: id,
    });
    return updated;
  }

  /** Scheduling requires its own approval before the engine will queue. */
  async schedule(user: AuthUser, id: string, dto: ScheduleCampaignDto) {
    const campaign = await this.getOne(user, id);
    if (campaign.status !== CampaignStatus.APPROVED) {
      throw new BadRequestException(
        'Campaign must be approved before it can be scheduled.',
      );
    }
    const schedule = await this.prisma.schedule.create({
      data: {
        campaignId: id,
        scheduledAt: new Date(dto.scheduledAt),
        timezone: dto.timezone ?? campaign.timezone,
      },
    });
    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.SCHEDULED, startAt: schedule.scheduledAt },
    });
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.SCHEDULE,
      entityId: schedule.id,
    });
    return schedule;
  }

  async pause(user: AuthUser, id: string) {
    const campaign = await this.getOne(user, id);
    if (campaign.status !== CampaignStatus.RUNNING) {
      throw new BadRequestException('Only running campaigns can be paused.');
    }
    return this.setStatus(id, CampaignStatus.PAUSED);
  }

  async resume(user: AuthUser, id: string) {
    const campaign = await this.getOne(user, id);
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('Only paused campaigns can be resumed.');
    }
    return this.setStatus(id, CampaignStatus.RUNNING);
  }

  /** Aggregates events into the campaign performance card. */
  async analytics(user: AuthUser, id: string) {
    await this.getOne(user, id);
    const grouped = await this.prisma.emailEvent.groupBy({
      by: ['eventType'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.eventType] = g._count._all;

    const sent = counts[EventType.SENT] ?? 0;
    const pct = (n: number) => (sent ? Math.round((n / sent) * 1000) / 10 : 0);
    return {
      sent,
      delivered: counts[EventType.DELIVERED] ?? 0,
      opens: counts[EventType.OPEN] ?? 0,
      clicks: counts[EventType.CLICK] ?? 0,
      replies: counts[EventType.REPLY] ?? 0,
      bounces: counts[EventType.BOUNCE] ?? 0,
      unsubscribes: counts[EventType.UNSUBSCRIBE] ?? 0,
      openRate: pct(counts[EventType.OPEN] ?? 0),
      clickRate: pct(counts[EventType.CLICK] ?? 0),
      replyRate: pct(counts[EventType.REPLY] ?? 0),
      bounceRate: pct(counts[EventType.BOUNCE] ?? 0),
    };
  }

  private setStatus(id: string, status: CampaignStatus) {
    return this.prisma.campaign.update({ where: { id }, data: { status } });
  }

  private assertEditable(status: CampaignStatus) {
    if (!EDITABLE.includes(status)) {
      throw new BadRequestException(
        `Campaign cannot be edited while ${status}.`,
      );
    }
  }
}
