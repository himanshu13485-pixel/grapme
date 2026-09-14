import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApprovalEntity,
  CampaignStatus,
  EventType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { GeoService } from '../common/services/geo.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  assertClientAccess,
  ownedClientIds,
  resourceClientScope,
} from '../common/client-scope';
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
    private geo: GeoService,
  ) {}

  /** Geo breakdown of this campaign's opens/clicks (by recipient IP). */
  async geoBreakdown(user: AuthUser, id: string) {
    await this.getOne(user, id);
    const evs = await this.prisma.emailEvent.findMany({
      where: {
        campaignId: id,
        eventType: { in: [EventType.OPEN, EventType.CLICK] },
      },
      select: { eventType: true, meta: true },
    });
    return this.geo.aggregate(
      evs.map((e) => ({
        ip: (e.meta as { ip?: string } | null)?.ip ?? null,
        eventType: e.eventType as 'OPEN' | 'CLICK',
      })),
    );
  }

  /** Keeps a client-portal user inside their own workspaces (staff: no restriction). */
  private async ownScope(user: AuthUser): Promise<Record<string, unknown>> {
    const ids = await ownedClientIds(this.prisma, user);
    return ids === null ? {} : { clientId: { in: ids } };
  }

  async list(user: AuthUser, clientId?: string) {
    const scope = await resourceClientScope(this.prisma, user, clientId);
    return this.prisma.campaign.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { steps: true, messages: true } },
        client: { select: { id: true, name: true } },
      },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId: user.tenantId, ...(await this.ownScope(user)) },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, schedules: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /** Delete a campaign and its steps/recipients/messages (cascade). Email
   *  events keep their history but are detached (campaignId nulled) so the
   *  non-cascading FK doesn't block the delete. */
  async remove(user: AuthUser, id: string) {
    await this.getOne(user, id);
    await this.prisma.$transaction([
      this.prisma.emailEvent.updateMany({
        where: { campaignId: id },
        data: { campaignId: null },
      }),
      this.prisma.campaign.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  async create(user: AuthUser, dto: CreateCampaignDto) {
    if (user.role === Role.CLIENT) {
      await assertClientAccess(this.prisma, user, dto.clientId);
      await this.assertOwnRefs(user, dto.clientId, dto);
    }
    // Enforce the plan's Email campaign limit for the target client (0 = unlimited).
    if (dto.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, tenantId: user.tenantId },
        select: { emailCampaignLimit: true },
      });
      if (client?.emailCampaignLimit && client.emailCampaignLimit > 0) {
        const used = await this.prisma.campaign.count({ where: { clientId: dto.clientId } });
        if (used >= client.emailCampaignLimit) {
          throw new BadRequestException(`Email campaign limit reached (${client.emailCampaignLimit}) for this client's plan.`);
        }
      }
    }
    return this.prisma.campaign.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        clientLabel: dto.clientLabel,
        clientId: dto.clientId || null,
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
    if (user.role === Role.CLIENT) {
      const clientId = dto.clientId !== undefined ? dto.clientId : campaign.clientId;
      await assertClientAccess(this.prisma, user, clientId);
      await this.assertOwnRefs(user, clientId, dto);
    }
    return this.prisma.campaign.update({ where: { id }, data: { ...dto } });
  }

  async addStep(user: AuthUser, id: string, dto: AddStepDto) {
    const campaign = await this.getOne(user, id);
    this.assertEditable(campaign.status);
    await this.assertOwnRefs(user, campaign.clientId, { templateId: dto.templateId });
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

  /** Stop a campaign for good — pending sends are dropped (status guards them). */
  async stop(user: AuthUser, id: string) {
    await this.getOne(user, id);
    return this.setStatus(id, CampaignStatus.COMPLETED);
  }

  /** Aggregates events into the campaign performance card. */
  async analytics(user: AuthUser, id: string, opts: { period?: string; from?: string; to?: string } = {}) {
    await this.getOne(user, id);
    // Window events by occurrence time (lifetime = no time filter).
    const period = ['week', 'month', 'custom'].includes(opts.period ?? '') ? opts.period! : 'lifetime';
    const now = new Date();
    const midnight = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
    let timeWhere: { occurredAt?: { gte: Date; lte: Date } } = {};
    if (period === 'week') { const s = midnight(now); s.setUTCDate(s.getUTCDate() - 6); timeWhere = { occurredAt: { gte: s, lte: now } }; }
    else if (period === 'month') { const s = midnight(now); s.setUTCDate(s.getUTCDate() - 29); timeWhere = { occurredAt: { gte: s, lte: now } }; }
    else if (period === 'custom' && opts.from) { timeWhere = { occurredAt: { gte: midnight(new Date(opts.from)), lte: opts.to ? new Date(`${opts.to}T23:59:59Z`) : now } }; }
    const eventWhere = { campaignId: id, ...timeWhere };

    const grouped = await this.prisma.emailEvent.groupBy({
      by: ['eventType'],
      where: eventWhere,
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.eventType] = g._count._all;

    // Forwarded (estimated) = messages opened from 2+ distinct IPs.
    const opensWithIp = await this.prisma.emailEvent.findMany({
      where: { ...eventWhere, eventType: EventType.OPEN },
      select: { messageId: true, meta: true },
    });
    const ipsByMsg = new Map<string, Set<string>>();
    for (const e of opensWithIp) {
      const ip = (e.meta as { ip?: string } | null)?.ip;
      if (!ip) continue;
      if (!ipsByMsg.has(e.messageId)) ipsByMsg.set(e.messageId, new Set());
      ipsByMsg.get(e.messageId)!.add(ip);
    }
    let forwarded = 0;
    for (const ips of ipsByMsg.values()) if (ips.size >= 2) forwarded++;

    const sent = counts[EventType.SENT] ?? 0;
    const bounces = counts[EventType.BOUNCE] ?? 0;
    const pct = (n: number) => (sent ? Math.round((n / sent) * 1000) / 10 : 0);
    // Delivered = sent that didn't bounce; rate over all attempts (sent+bounced).
    const attempts = sent + bounces;
    const deliveryRate = attempts ? Math.round((sent / attempts) * 1000) / 10 : 0;
    return {
      sent,
      delivered: sent,
      opens: counts[EventType.OPEN] ?? 0,
      clicks: counts[EventType.CLICK] ?? 0,
      replies: counts[EventType.REPLY] ?? 0,
      bounces,
      unsubscribes: counts[EventType.UNSUBSCRIBE] ?? 0,
      forwarded,
      deliveryRate,
      openRate: pct(counts[EventType.OPEN] ?? 0),
      clickRate: pct(counts[EventType.CLICK] ?? 0),
      replyRate: pct(counts[EventType.REPLY] ?? 0),
      bounceRate: pct(counts[EventType.BOUNCE] ?? 0),
      forwardRate: pct(forwarded),
    };
  }

  /** A client may only wire its own workspace's mailbox, list and template into a campaign. */
  private async assertOwnRefs(
    user: AuthUser,
    clientId: string | null | undefined,
    refs: { emailAccountId?: string | null; listId?: string | null; templateId?: string | null },
  ) {
    if (user.role !== Role.CLIENT) return;
    const where = { tenantId: user.tenantId, clientId: clientId ?? '__none__' };
    if (refs.emailAccountId && !(await this.prisma.emailAccount.count({ where: { id: refs.emailAccountId, ...where } }))) {
      throw new BadRequestException('Choose a mailbox from this workspace.');
    }
    if (refs.listId && !(await this.prisma.contactList.count({ where: { id: refs.listId, ...where } }))) {
      throw new BadRequestException('Choose a contact list from this workspace.');
    }
    if (refs.templateId && !(await this.prisma.emailTemplate.count({ where: { id: refs.templateId, ...where } }))) {
      throw new BadRequestException('Choose a template from this workspace.');
    }
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
