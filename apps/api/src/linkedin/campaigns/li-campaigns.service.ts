import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LiCampaignStatus, LiLeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LiSchedulerService } from '../scheduler/li-scheduler.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto,
  UpsertLiAudienceDto, UpdateLiScheduleDto, ImportLiLeadsDto,
} from './dto/campaign.dto';

const EDITABLE: LiCampaignStatus[] = [LiCampaignStatus.DRAFT, LiCampaignStatus.PAUSED];

@Injectable()
export class LiCampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: LiSchedulerService,
  ) {}

  async create(tenantId: string, dto: CreateLiCampaignDto) {
    const account = await this.prisma.linkedInAccount.findFirst({
      where: { id: dto.linkedInAccountId, clientId: dto.clientId },
    });
    if (!account) throw new BadRequestException('LinkedIn account not in this client');

    return this.prisma.liCampaign.create({
      data: {
        tenantId,
        clientId: dto.clientId,
        linkedInAccountId: dto.linkedInAccountId,
        name: dto.name,
        type: dto.type ?? undefined,
        mode: dto.mode ?? undefined,
        outreachType: dto.outreachType ?? undefined,
        timezone: dto.timezone ?? undefined,
        businessProfileId: dto.businessProfileId ?? undefined,
        strategyId: dto.strategyId ?? undefined,
      },
    });
  }

  list(clientId: string, status?: LiCampaignStatus) {
    return this.prisma.liCampaign.findMany({
      where: { clientId, status: status ?? { not: LiCampaignStatus.DELETED } },
      orderBy: { createdAt: 'desc' },
      include: {
        linkedInAccount: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { leads: true } },
      },
    });
  }

  async get(id: string) {
    const c = await this.prisma.liCampaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { order: 'asc' } },
        audienceSpec: true,
        linkedInAccount: true,
        businessProfile: { select: { id: true, name: true, completeness: true } },
        strategy: { select: { id: true, name: true, completeness: true } },
      },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  async update(id: string, dto: UpdateLiCampaignDto) {
    await this.assertExists(id);
    return this.prisma.liCampaign.update({ where: { id }, data: dto });
  }

  async updateSequence(id: string, dto: UpdateLiSequenceDto) {
    const c = await this.get(id);
    if (!EDITABLE.includes(c.status)) throw new BadRequestException('Pause the campaign before changing its sequence');
    const direct = c.outreachType === 'DIRECT_MESSAGES';
    if (!direct && dto.steps[0].type !== 'CONNECTION_REQUEST') {
      throw new BadRequestException('First step must be a CONNECTION_REQUEST');
    }
    if (direct && dto.steps[0].type !== 'MESSAGE') {
      throw new BadRequestException('Direct-message campaigns must start with a MESSAGE');
    }
    await this.prisma.$transaction([
      this.prisma.liSequenceStep.deleteMany({ where: { campaignId: id } }),
      this.prisma.liSequenceStep.createMany({
        data: dto.steps.map((s, i) => ({
          campaignId: id, order: i + 1, type: s.type, waitHours: s.waitHours, body: s.body, note: s.note,
        })),
      }),
    ]);
    return this.get(id);
  }

  async upsertAudience(id: string, dto: UpsertLiAudienceDto) {
    await this.assertExists(id);
    const data = {
      countries: dto.countries ?? [], cities: dto.cities ?? [],
      industries: dto.industries ?? [], companySizes: dto.companySizes ?? [],
      departments: dto.departments ?? [], jobTitles: dto.jobTitles ?? [], seniorities: dto.seniorities ?? [],
      companyKeywordsInclude: dto.companyKeywordsInclude ?? [], companyKeywordsExclude: dto.companyKeywordsExclude ?? [],
      personKeywordsInclude: dto.personKeywordsInclude ?? [], personKeywordsExclude: dto.personKeywordsExclude ?? [],
    };
    return this.prisma.liTargetAudienceSpec.upsert({
      where: { campaignId: id },
      create: { campaignId: id, ...data },
      update: data,
    });
  }

  async updateSchedule(id: string, dto: UpdateLiScheduleDto) {
    await this.assertExists(id);
    return this.prisma.liCampaign.update({ where: { id }, data: dto });
  }

  async importLeads(id: string, dto: ImportLiLeadsDto) {
    await this.assertExists(id);
    const rows: Prisma.LiLeadCreateManyInput[] = dto.leads.map((l) => ({
      campaignId: id,
      fullName: l.fullName,
      firstName: l.firstName ?? l.fullName.split(' ')[0],
      lastName: l.lastName,
      title: l.title,
      company: l.company,
      location: l.location,
      profileUrl: l.profileUrl,
      status: LiLeadStatus.PENDING,
      currentStep: 0,
    }));
    const res = await this.prisma.liLead.createMany({ data: rows });
    return { imported: res.count };
  }

  async leads(id: string, opts: { status?: LiLeadStatus; page?: number; pageSize?: number; search?: string }) {
    await this.assertExists(id);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const where: Prisma.LiLeadWhereInput = {
      campaignId: id,
      status: opts.status,
      ...(opts.search
        ? { OR: [
            { fullName: { contains: opts.search, mode: 'insensitive' } },
            { company: { contains: opts.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [total, items, counts] = await this.prisma.$transaction([
      this.prisma.liLead.count({ where }),
      this.prisma.liLead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.liLead.groupBy({ by: ['status'], where: { campaignId: id }, _count: true, orderBy: { status: 'asc' } }),
    ]);
    const tabCounts = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), items, tabCounts };
  }

  async stats(id: string) {
    await this.assertExists(id);
    const [byStatus, bySentiment, totalMessages] = await this.prisma.$transaction([
      this.prisma.liLead.groupBy({ by: ['status'], where: { campaignId: id }, _count: true, orderBy: { status: 'asc' } }),
      this.prisma.liLead.groupBy({ by: ['sentiment'], where: { campaignId: id, sentiment: { not: null } }, _count: true, orderBy: { sentiment: 'asc' } }),
      this.prisma.liMessage.count({ where: { conversation: { lead: { campaignId: id } } } }),
    ]);
    const s = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Record<string, number>;
    const g = (k: string) => s[k] ?? 0;
    const replied = g('REPLIED');
    const accepted = g('CONNECTED') + g('MESSAGED') + replied;
    const sent = g('CONNECTION_PENDING') + accepted;
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const r of bySentiment) {
      const n = Number(r._count);
      if (r.sentiment === 'POSITIVE') sentiment.positive = n;
      else if (r.sentiment === 'NEGATIVE') sentiment.negative = n;
      else if (r.sentiment === 'NEUTRAL') sentiment.neutral = n;
    }
    const series = await this.dailySeries(id);
    return {
      sent, accepted, replied, totalMessages, sentiment,
      acceptanceRate: sent ? Math.round((accepted / sent) * 1000) / 10 : 0,
      replyRate: accepted ? Math.round((replied / accepted) * 1000) / 10 : 0,
      series,
    };
  }

  /** Daily buckets (last 30 days, UTC) powering the Analytics charts:
   *  connections Sent (completed SEND_CONNECTION actions), Accepted (connectedAt),
   *  Messages (outbound) and Replies (inbound). */
  private async dailySeries(campaignId: string) {
    const DAYS = 30;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (DAYS - 1));

    const [sentActions, acceptedLeads, msgs] = await Promise.all([
      this.prisma.liScheduledAction.findMany({
        where: { lead: { campaignId }, type: 'SEND_CONNECTION', status: 'DONE', updatedAt: { gte: since } },
        select: { updatedAt: true },
      }),
      this.prisma.liLead.findMany({ where: { campaignId, connectedAt: { gte: since } }, select: { connectedAt: true } }),
      this.prisma.liMessage.findMany({
        where: { conversation: { lead: { campaignId } }, sentAt: { gte: since } },
        select: { sentAt: true, direction: true },
      }),
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const buckets = new Map<string, { date: string; sent: number; accepted: number; messages: number; replies: number }>();
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(since); d.setUTCDate(since.getUTCDate() + i);
      buckets.set(key(d), { date: key(d), sent: 0, accepted: 0, messages: 0, replies: 0 });
    }
    for (const a of sentActions) { const b = buckets.get(key(a.updatedAt)); if (b) b.sent++; }
    for (const l of acceptedLeads) { if (l.connectedAt) { const b = buckets.get(key(l.connectedAt)); if (b) b.accepted++; } }
    for (const m of msgs) { const b = buckets.get(key(m.sentAt)); if (b) { if (m.direction === 'INBOUND') b.replies++; else b.messages++; } }
    return [...buckets.values()];
  }

  async setStatus(id: string, status: LiCampaignStatus) {
    await this.assertExists(id);
    const data: { status: LiCampaignStatus; warmupStartedAt?: Date } = { status };
    if (status === LiCampaignStatus.RUNNING) {
      // Anchor the warm-up ramp the first time the campaign starts sending.
      const c = await this.prisma.liCampaign.findUnique({ where: { id }, select: { warmupStartedAt: true } });
      if (!c?.warmupStartedAt) data.warmupStartedAt = new Date();
    }
    const campaign = await this.prisma.liCampaign.update({ where: { id }, data });
    const STOP: LiCampaignStatus[] = [
      LiCampaignStatus.PAUSED, LiCampaignStatus.ARCHIVED, LiCampaignStatus.DELETED, LiCampaignStatus.COMPLETED,
    ];
    if (status === LiCampaignStatus.RUNNING) {
      await this.scheduler.startCampaign(id);
    } else if (STOP.includes(status)) {
      await this.scheduler.pauseCampaign(id);
    }
    return campaign;
  }

  private async assertExists(id: string) {
    const n = await this.prisma.liCampaign.count({ where: { id } });
    if (!n) throw new NotFoundException('Campaign not found');
  }
}
