import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalEntity, ApprovalStatus, LiCampaignStatus, LiCreditReason, LiLeadStatus, LiScheduledActionStatus, LiScheduledActionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LiSchedulerService } from '../scheduler/li-scheduler.service';
import { normalizeProfileUrl } from '../scheduler/li-queue.constants';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import {
  CreateLiCampaignDto, UpdateLiCampaignDto, UpdateLiSequenceDto,
  UpsertLiAudienceDto, UpdateLiScheduleDto, ImportLiLeadsDto,
} from './dto/campaign.dto';

const EDITABLE: LiCampaignStatus[] = [LiCampaignStatus.DRAFT, LiCampaignStatus.PAUSED];

/** pausedReason written when a client's subscription lapses or is deactivated. */
export const CLIENT_SUSPENDED_REASON = 'Client subscription inactive — resumes on renewal or reactivation';

@Injectable()
export class LiCampaignsService {
  private readonly logger = new Logger(LiCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: LiSchedulerService,
    private readonly subs: LinkedInSubscriptionService,
  ) {}

  async create(tenantId: string, dto: CreateLiCampaignDto) {
    const account = await this.prisma.linkedInAccount.findFirst({
      where: { id: dto.linkedInAccountId, clientId: dto.clientId },
    });
    if (!account) throw new BadRequestException('LinkedIn account not in this client');

    // Inherit the client's LinkedIn sending defaults (set at registration) so every
    // new campaign starts from the admin-approved working hours / caps / warm-up / drip.
    const sub = await this.prisma.linkedInSubscription.findUnique({
      where: { clientId: dto.clientId },
      select: { timezone: true, campaignDefaults: true, campaignLimit: true },
    });
    // Enforce the plan's LinkedIn campaign limit (0 = unlimited).
    if (sub?.campaignLimit && sub.campaignLimit > 0) {
      const used = await this.prisma.liCampaign.count({
        // Only ONGOING campaigns use a plan slot; completed/archived/deleted don't count.
        where: { clientId: dto.clientId, status: { in: LiCampaignsService.ONGOING } },
      });
      if (used >= sub.campaignLimit) {
        throw new BadRequestException(`LinkedIn campaign limit reached (${sub.campaignLimit}) for this client's plan.`);
      }
    }
    const d = (sub?.campaignDefaults ?? {}) as Record<string, unknown>;
    const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
    const bool = (k: string) => (typeof d[k] === 'boolean' ? (d[k] as boolean) : undefined);
    const days = Array.isArray(d.workDays) ? (d.workDays as number[]) : undefined;

    return this.prisma.liCampaign.create({
      data: {
        tenantId,
        clientId: dto.clientId,
        linkedInAccountId: dto.linkedInAccountId,
        name: dto.name,
        type: dto.type ?? undefined,
        mode: dto.mode ?? undefined,
        outreachType: dto.outreachType ?? undefined,
        timezone: dto.timezone ?? sub?.timezone ?? undefined,
        run247: bool('run247'),
        workStartHour: num('workStartHour'),
        workEndHour: num('workEndHour'),
        workDays: days,
        dailyConnectionLimit: num('dailyConnectionLimit'),
        dailyMessageLimit: num('dailyMessageLimit'),
        jitterMinSeconds: num('jitterMinSeconds'),
        jitterMaxSeconds: num('jitterMaxSeconds'),
        followUpMin: num('followUpMin'),
        followUpMax: num('followUpMax'),
        graceHours: num('graceHours'),
        warmupEnabled: bool('warmupEnabled'),
        warmupStartLimit: num('warmupStartLimit'),
        warmupDays: num('warmupDays'),
        connectionWindowDays: num('connectionWindowDays'),
        dripEnabled: bool('dripEnabled'),
        dripDailyTarget: num('dripDailyTarget'),
        dripBuffer: num('dripBuffer'),
        businessProfileId: dto.businessProfileId ?? undefined,
        strategyId: dto.strategyId ?? undefined,
      },
    });
  }

  /** Lifecycle buckets: ongoing (draft/running/paused), completed, archived, deleted. */
  static readonly ONGOING = [LiCampaignStatus.DRAFT, LiCampaignStatus.RUNNING, LiCampaignStatus.PAUSED];

  /**
   * CUMULATIVE Target-Audience pipeline (WDC-style): picking a stage includes every
   * lead at that stage OR beyond. E.g. "Connected" = connected, messaged, replied and
   * campaign-completed. Terminal buckets (Replied / Completed / Bounced / Excluded) are
   * exact. Powers both the filtered list and the pipeline counts.
   */
  static readonly LEAD_PIPELINE: Record<string, LiLeadStatus[]> = {
    PENDING: [LiLeadStatus.PENDING],
    CONNECTION_PENDING: [
      LiLeadStatus.CONNECTION_PENDING, LiLeadStatus.CONNECTED, LiLeadStatus.MESSAGED,
      LiLeadStatus.REPLIED, LiLeadStatus.CAMPAIGN_COMPLETED, LiLeadStatus.NOT_ACCEPTED,
    ],
    NOT_ACCEPTED: [LiLeadStatus.NOT_ACCEPTED],
    CONNECTED: [
      LiLeadStatus.CONNECTED, LiLeadStatus.MESSAGED, LiLeadStatus.REPLIED, LiLeadStatus.CAMPAIGN_COMPLETED,
    ],
    MESSAGED: [LiLeadStatus.MESSAGED, LiLeadStatus.REPLIED, LiLeadStatus.CAMPAIGN_COMPLETED],
    REPLIED: [LiLeadStatus.REPLIED],
    CAMPAIGN_COMPLETED: [LiLeadStatus.CAMPAIGN_COMPLETED],
    BOUNCED: [LiLeadStatus.BOUNCED],
    EXCLUDED: [LiLeadStatus.EXCLUDED],
  };
  private viewFilter(view?: string) {
    if (view === 'completed') return { status: LiCampaignStatus.COMPLETED };
    if (view === 'archived') return { status: LiCampaignStatus.ARCHIVED };
    if (view === 'deleted') return { status: LiCampaignStatus.DELETED };
    if (view === 'ongoing') return { status: { in: LiCampaignsService.ONGOING } };
    return { status: { not: LiCampaignStatus.DELETED } }; // default (back-compat)
  }

  async list(clientId: string, view?: string) {
    const campaigns = await this.prisma.liCampaign.findMany({
      where: { clientId, ...this.viewFilter(view) },
      orderBy: { createdAt: 'desc' },
      include: {
        linkedInAccount: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { leads: true } },
      },
    });
    // Flag campaigns awaiting admin approval so the UI can show "Under review"
    // instead of the Submit/Edit actions.
    const pending = campaigns.length
      ? await this.prisma.approval.findMany({
          where: { entityType: ApprovalEntity.LI_CAMPAIGN, status: ApprovalStatus.PENDING, entityId: { in: campaigns.map((c) => c.id) } },
          select: { entityId: true },
        })
      : [];
    const pendingSet = new Set(pending.map((p) => p.entityId));
    return campaigns.map((c) => ({ ...c, pendingApproval: pendingSet.has(c.id) }));
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
          campaignId: id, order: i + 1, type: s.type, condition: s.condition ?? 'ANY', waitHours: s.waitHours,
          body: normalizeTokens(s.body), note: normalizeTokens(s.note),
          // Random-choice group id (MESSAGE steps only; one of a group is sent per lead).
          randomGroup: s.randomGroup ?? null,
          // Keep only non-empty alternate wordings.
          variants: (s.variants ?? []).map((v) => normalizeTokens(v)?.trim() ?? '').filter((v) => v.length > 0),
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
    // Keep the follow-up range coherent (max never below min).
    if (dto.followUpMin != null && dto.followUpMax != null && dto.followUpMax < dto.followUpMin) {
      dto.followUpMax = dto.followUpMin;
    }
    return this.prisma.liCampaign.update({ where: { id }, data: dto });
  }

  async importLeads(id: string, dto: ImportLiLeadsDto) {
    await this.assertExists(id);
    const campaign = await this.prisma.liCampaign.findUnique({ where: { id }, select: { tenantId: true, clientId: true } });
    if (!campaign) throw new BadRequestException('Campaign not found');
    // Optional per-client credit metering: 1 credit PER lead added.
    const client = await this.prisma.client.findUnique({ where: { id: campaign.clientId }, select: { linkedInCreditMetering: true } });
    const metered = !!client?.linkedInCreditMetering;
    let balance = Infinity;
    if (metered) {
      const sub = await this.subs.getOrCreate(campaign.tenantId, campaign.clientId);
      balance = sub.creditsBalance;
      if (balance < 1) throw new BadRequestException('Insufficient LinkedIn credits to import leads.');
    }
    // Skip anyone already in this campaign — matched by CANONICAL profile URL, so a
    // trailing slash / http vs https / casing difference no longer sneaks in a dup.
    const existing = await this.prisma.liLead.findMany({ where: { campaignId: id }, select: { profileUrl: true } });
    const seen = new Set(existing.map((l) => normalizeProfileUrl(l.profileUrl)).filter(Boolean) as string[]);
    const rows: Prisma.LiLeadCreateManyInput[] = [];
    let skipped = 0;
    for (const l of dto.leads) {
      const url = normalizeProfileUrl(l.profileUrl);
      if (url) {
        if (seen.has(url)) { skipped++; continue; } // duplicate — don't add again
        seen.add(url);
      }
      rows.push({
        campaignId: id,
        fullName: l.fullName,
        firstName: l.firstName ?? l.fullName.split(' ')[0],
        lastName: l.lastName,
        title: l.title,
        company: l.company,
        location: l.location,
        profileUrl: url,
        status: LiLeadStatus.PENDING,
        currentStep: 0,
      });
    }
    const res = rows.length
      ? await this.prisma.liLead.createMany({ data: rows, skipDuplicates: true })
      : { count: 0 };
    let creditsCharged = 0;
    if (metered && res.count > 0) {
      creditsCharged = Math.min(res.count, balance);
      await this.subs.debit(campaign.tenantId, campaign.clientId, creditsCharged, LiCreditReason.LEAD_SOURCING, { refType: 'LiCampaign', refId: id });
    }
    // Enqueue the new leads if the campaign is already running (else they'd sit PENDING).
    if (res.count > 0) await this.scheduler.enqueueNewLeads(id).catch(() => undefined);
    return { imported: res.count, skipped, creditsCharged };
  }

  /** Enqueue newly-added leads on a running campaign (used after imports/sourcing). */
  enqueueNewLeads(campaignId: string) {
    return this.scheduler.enqueueNewLeads(campaignId);
  }

  // ── Reusable audience presets (tenant-wide templates) ────────────────
  private sanitizeAudienceSpec(spec: unknown): Prisma.InputJsonValue {
    const s = (spec && typeof spec === 'object' ? spec : {}) as Record<string, unknown>;
    const arr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()).slice(0, 50) : [];
    const keys = [
      'countries', 'cities', 'industries', 'companySizes', 'departments', 'jobTitles',
      'seniorities', 'companyKeywordsInclude', 'companyKeywordsExclude',
      'personKeywordsInclude', 'personKeywordsExclude',
    ];
    const out: Record<string, string[]> = {};
    for (const k of keys) out[k] = arr(s[k]);
    return out as Prisma.InputJsonValue;
  }

  /** Presets are scoped to a single client workspace (shared across its campaigns). */
  listPresets(tenantId: string, clientId: string) {
    return this.prisma.liAudiencePreset.findMany({
      where: { tenantId, clientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPreset(tenantId: string, clientId: string, name: string, spec: unknown) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Preset name is required.');
    return this.prisma.liAudiencePreset.create({
      data: { tenantId, clientId, name: clean.slice(0, 80), spec: this.sanitizeAudienceSpec(spec) },
    });
  }

  async deletePreset(tenantId: string, clientId: string, id: string) {
    await this.prisma.liAudiencePreset.deleteMany({ where: { id, tenantId, clientId } });
    return { ok: true };
  }

  /** Remove a lead from a campaign's Target Audience (cancels its queued jobs). */
  async deleteLead(campaignId: string, leadId: string) {
    await this.assertExists(campaignId);
    const lead = await this.prisma.liLead.findFirst({
      where: { id: leadId, campaignId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    await this.scheduler.removeLeadJobs(leadId).catch(() => undefined);
    await this.prisma.liLead.delete({ where: { id: leadId } }); // cascades its scheduled actions
    return { ok: true };
  }

  /**
   * Replicate a campaign: same settings, audience criteria and message sequence,
   * as a fresh DRAFT. Deliberately NOT copied — the audience leads, run state
   * (warm-up/drip stamps) and status — so the copy starts clean and is launched
   * only after review.
   */
  async duplicate(campaignId: string) {
    const src = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { audienceSpec: true, steps: { orderBy: { order: 'asc' } } },
    });
    if (!src) throw new NotFoundException('Campaign not found');

    // "Name", "Name (copy)", "Name (copy 2)" … so repeated clones don't collide.
    const base = src.name.replace(/\s*\(copy(?: \d+)?\)\s*$/i, '').trim();
    const siblings = await this.prisma.liCampaign.findMany({
      where: { clientId: src.clientId, deletedAt: null, name: { startsWith: base } },
      select: { name: true },
    });
    let name = `${base} (copy)`;
    for (let n = 2; siblings.some((s) => s.name === name); n++) name = `${base} (copy ${n})`;

    return this.prisma.liCampaign.create({
      data: {
        tenantId: src.tenantId,
        clientId: src.clientId,
        linkedInAccountId: src.linkedInAccountId,
        name,
        status: LiCampaignStatus.DRAFT,
        type: src.type,
        mode: src.mode,
        outreachType: src.outreachType,
        timezone: src.timezone,
        run247: src.run247,
        workStartHour: src.workStartHour,
        workEndHour: src.workEndHour,
        workDays: src.workDays,
        dailyConnectionLimit: src.dailyConnectionLimit,
        dailyMessageLimit: src.dailyMessageLimit,
        jitterMinSeconds: src.jitterMinSeconds,
        jitterMaxSeconds: src.jitterMaxSeconds,
        followUpMin: src.followUpMin,
        followUpMax: src.followUpMax,
        graceHours: src.graceHours,
        warmupEnabled: src.warmupEnabled,
        warmupStartLimit: src.warmupStartLimit,
        warmupDays: src.warmupDays,
        connectionWindowDays: src.connectionWindowDays,
        minConnections: src.minConnections,
        maxConnections: src.maxConnections,
        dripEnabled: src.dripEnabled,
        dripDailyTarget: src.dripDailyTarget,
        dripBuffer: src.dripBuffer,
        businessProfileId: src.businessProfileId,
        strategyId: src.strategyId,
        // Message sequence, including per-step accept-branch condition + variants.
        steps: {
          create: src.steps.map((s) => ({
            order: s.order,
            type: s.type,
            condition: s.condition,
            waitHours: s.waitHours,
            body: s.body,
            note: s.note,
            variants: s.variants,
            randomGroup: s.randomGroup,
          })),
        },
        // Target-audience criteria (the search spec, not the sourced leads).
        ...(src.audienceSpec
          ? {
              audienceSpec: {
                create: {
                  countries: src.audienceSpec.countries,
                  cities: src.audienceSpec.cities,
                  industries: src.audienceSpec.industries,
                  companySizes: src.audienceSpec.companySizes,
                  departments: src.audienceSpec.departments,
                  jobTitles: src.audienceSpec.jobTitles,
                  seniorities: src.audienceSpec.seniorities,
                  companyKeywordsInclude: src.audienceSpec.companyKeywordsInclude,
                  companyKeywordsExclude: src.audienceSpec.companyKeywordsExclude,
                  personKeywordsInclude: src.audienceSpec.personKeywordsInclude,
                  personKeywordsExclude: src.audienceSpec.personKeywordsExclude,
                },
              },
            }
          : {}),
      },
      select: { id: true, name: true },
    });
  }

  /** Admin test: run ONE lead's next action right away (caps + warm-up still apply). */
  async sendNowForLead(campaignId: string, leadId: string) {
    const c = await this.prisma.liCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.status !== LiCampaignStatus.RUNNING) {
      throw new BadRequestException('Start the campaign first, then send.');
    }
    return this.scheduler.runNowForLead(campaignId, leadId);
  }

  /** Bulk-remove leads from a campaign's audience (admin cleanup, e.g. duplicates). */
  async deleteLeads(campaignId: string, leadIds: string[]) {
    await this.assertExists(campaignId);
    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new BadRequestException('Select at least one lead to delete.');
    // Only leads that actually belong to this campaign.
    const leads = await this.prisma.liLead.findMany({
      where: { id: { in: ids }, campaignId },
      select: { id: true },
    });
    if (leads.length === 0) throw new NotFoundException('No matching leads found');
    // Drop any queued work first so nothing fires for a deleted lead.
    for (const l of leads) await this.scheduler.removeLeadJobs(l.id).catch(() => undefined);
    const res = await this.prisma.liLead.deleteMany({ where: { id: { in: leads.map((l) => l.id) }, campaignId } });
    return { ok: true, deleted: res.count };
  }

  async leads(id: string, opts: { status?: LiLeadStatus; page?: number; pageSize?: number; search?: string; step?: number; sentFrom?: string; sentTo?: string }) {
    await this.assertExists(id);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    // Expand a picked stage to its cumulative set (Connected = connected-or-beyond, …).
    const pipeline = opts.status ? LiCampaignsService.LEAD_PIPELINE[opts.status] : undefined;
    const sentRange = dateRange(opts.sentFrom, opts.sentTo);
    const where: Prisma.LiLeadWhereInput = {
      campaignId: id,
      ...(pipeline ? { status: { in: pipeline } } : opts.status ? { status: opts.status } : {}),
      ...(opts.step != null && !Number.isNaN(opts.step) ? { currentStep: opts.step } : {}),
      ...(sentRange ? { lastActionAt: sentRange } : {}),
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
    // Raw per-status counts, plus cumulative pipeline counts for the WDC-style tabs.
    const tabCounts = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
    const cumulativeCounts = Object.fromEntries(
      Object.entries(LiCampaignsService.LEAD_PIPELINE).map(
        ([tab, statuses]) => [tab, statuses.reduce((a, s) => a + (tabCounts[s] ?? 0), 0)],
      ),
    );
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), items, tabCounts, cumulativeCounts };
  }

  async stats(id: string, opts: { period?: string; from?: string; to?: string } = {}) {
    await this.assertExists(id);
    const period = ['week', 'month', 'custom'].includes(opts.period ?? '') ? opts.period! : 'lifetime';
    const now = new Date();
    const midnight = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };

    // Resolve the [since, until] window driving both the series and the windowed KPIs.
    let since: Date; let until = now;
    if (period === 'week') { since = midnight(now); since.setUTCDate(since.getUTCDate() - 6); }
    else if (period === 'month') { since = midnight(now); since.setUTCDate(since.getUTCDate() - 29); }
    else if (period === 'custom') {
      since = opts.from ? midnight(new Date(opts.from)) : midnight(new Date(now.getTime() - 29 * 864e5));
      until = opts.to ? new Date(`${opts.to}T23:59:59Z`) : now;
    } else {
      const c = await this.prisma.liCampaign.findUnique({ where: { id }, select: { createdAt: true } });
      since = midnight(c?.createdAt ?? new Date(now.getTime() - 29 * 864e5));
      const cap = midnight(new Date(now.getTime() - 365 * 864e5));
      if (since < cap) since = cap;
    }
    const series = await this.dailySeries(id, since, until);

    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    let sent: number; let accepted: number; let replied: number; let totalMessages: number;

    if (period === 'lifetime') {
      const [byStatus, bySentiment, totalMsg] = await this.prisma.$transaction([
        this.prisma.liLead.groupBy({ by: ['status'], where: { campaignId: id }, _count: true, orderBy: { status: 'asc' } }),
        this.prisma.liLead.groupBy({ by: ['sentiment'], where: { campaignId: id, sentiment: { not: null } }, _count: true, orderBy: { sentiment: 'asc' } }),
        this.prisma.liMessage.count({ where: { conversation: { lead: { campaignId: id } } } }),
      ]);
      const s = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Record<string, number>;
      const g = (k: string) => s[k] ?? 0;
      replied = g('REPLIED');
      // CAMPAIGN_COMPLETED leads connected + were messaged, they just never replied.
      accepted = g('CONNECTED') + g('MESSAGED') + g('CAMPAIGN_COMPLETED') + replied;
      // An invite was sent for every pending, accepted, AND not-accepted lead.
      sent = g('CONNECTION_PENDING') + accepted + g('NOT_ACCEPTED');
      totalMessages = totalMsg;
      for (const r of bySentiment) {
        const n = Number(r._count);
        if (r.sentiment === 'POSITIVE') sentiment.positive = n;
        else if (r.sentiment === 'NEGATIVE') sentiment.negative = n;
        else if (r.sentiment === 'NEUTRAL') sentiment.neutral = n;
      }
    } else {
      // Windowed KPIs from the series; sentiment from replies received in-window.
      sent = series.reduce((a, d) => a + d.sent, 0);
      accepted = series.reduce((a, d) => a + d.accepted, 0);
      replied = series.reduce((a, d) => a + d.replies, 0);
      totalMessages = series.reduce((a, d) => a + d.messages + d.replies, 0);
      const bySentiment = await this.prisma.liLead.groupBy({
        by: ['sentiment'],
        where: { campaignId: id, sentiment: { not: null }, lastReplyAt: { gte: since, lte: until } },
        _count: true, orderBy: { sentiment: 'asc' },
      });
      for (const r of bySentiment) {
        const n = Number(r._count);
        if (r.sentiment === 'POSITIVE') sentiment.positive = n;
        else if (r.sentiment === 'NEGATIVE') sentiment.negative = n;
        else if (r.sentiment === 'NEUTRAL') sentiment.neutral = n;
      }
    }
    return {
      period, sent, accepted, replied, totalMessages, sentiment,
      acceptanceRate: sent ? Math.round((accepted / sent) * 1000) / 10 : 0,
      replyRate: accepted ? Math.round((replied / accepted) * 1000) / 10 : 0,
      series,
    };
  }

  /** Daily buckets (last 30 days, UTC) powering the Analytics charts:
   *  connections Sent (completed SEND_CONNECTION actions), Accepted (connectedAt),
   *  Messages (outbound) and Replies (inbound). */
  private async dailySeries(campaignId: string, since: Date, until: Date) {
    const start = new Date(since); start.setUTCHours(0, 0, 0, 0);
    const DAYS = Math.min(400, Math.max(1, Math.floor((until.getTime() - start.getTime()) / 864e5) + 1));

    const [sentActions, acceptedLeads, msgs] = await Promise.all([
      this.prisma.liScheduledAction.findMany({
        where: { lead: { campaignId }, type: 'SEND_CONNECTION', status: 'DONE', updatedAt: { gte: start, lte: until } },
        select: { updatedAt: true },
      }),
      this.prisma.liLead.findMany({ where: { campaignId, connectedAt: { gte: start, lte: until } }, select: { connectedAt: true } }),
      this.prisma.liMessage.findMany({
        where: { conversation: { lead: { campaignId } }, sentAt: { gte: start, lte: until } },
        select: { sentAt: true, direction: true },
      }),
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const buckets = new Map<string, { date: string; sent: number; accepted: number; messages: number; replies: number }>();
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      buckets.set(key(d), { date: key(d), sent: 0, accepted: 0, messages: 0, replies: 0 });
    }
    for (const a of sentActions) { const b = buckets.get(key(a.updatedAt)); if (b) b.sent++; }
    for (const l of acceptedLeads) { if (l.connectedAt) { const b = buckets.get(key(l.connectedAt)); if (b) b.accepted++; } }
    for (const m of msgs) { const b = buckets.get(key(m.sentAt)); if (b) { if (m.direction === 'INBOUND') b.replies++; else b.messages++; } }
    return [...buckets.values()];
  }

  async setStatus(id: string, status: LiCampaignStatus) {
    await this.assertExists(id);
    const data: {
      status: LiCampaignStatus; warmupStartedAt?: Date; deletedAt?: Date | null;
      acceptanceGateFrom?: Date; pausedReason?: string | null;
    } = { status };
    if (status === LiCampaignStatus.DELETED) data.deletedAt = new Date();
    if (status === LiCampaignStatus.RUNNING) {
      // Anchor the warm-up ramp the first time the campaign starts sending.
      const c = await this.prisma.liCampaign.findUnique({ where: { id }, select: { warmupStartedAt: true, linkedInAccountId: true } });
      // A campaign whose account was removed keeps everything else; it just can't send.
      if (!c?.linkedInAccountId) {
        throw new BadRequestException('This campaign has no LinkedIn account. Attach one before starting it.');
      }
      if (!c.warmupStartedAt) data.warmupStartedAt = new Date();
      // Restart the acceptance sample on every start/resume, and clear any auto-pause
      // note. Without this a campaign paused for low acceptance would be re-paused by
      // the same historic invites the moment it resumed, with no way back.
      data.acceptanceGateFrom = new Date();
      data.pausedReason = null;
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

  /** Restore a soft-deleted (or archived) campaign back to DRAFT so it can be relaunched. */
  async restore(id: string) {
    return this.prisma.liCampaign.update({
      where: { id },
      data: { status: LiCampaignStatus.DRAFT, deletedAt: null },
    });
  }

  /** Hard-delete: cancel queued jobs, then cascade-remove the campaign and all its data. */
  async hardDelete(id: string) {
    try { await this.scheduler.pauseCampaign(id); } catch { /* jobs may already be gone */ }
    await this.prisma.liCampaign.delete({ where: { id } });
    return { ok: true };
  }

  /** Cron: permanently purge campaigns soft-deleted more than 30 days ago. */
  async purgeExpiredDeleted(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - 30 * 864e5);
    const rows = await this.prisma.liCampaign.findMany({
      where: { status: LiCampaignStatus.DELETED, deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const r of rows) await this.hardDelete(r.id).catch(() => undefined);
    return { purged: rows.length };
  }

  /** Admin test: fire this campaign's next scheduled action immediately (cap still enforced). */
  async sendNextNow(id: string) {
    const c = await this.prisma.liCampaign.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new BadRequestException('Campaign not found');
    if (c.status !== LiCampaignStatus.RUNNING) throw new BadRequestException('Start the campaign first, then send the next action.');
    return this.scheduler.runNext(id);
  }

  /** Admin: pull live profile + acceptance state from LinkedIn for this campaign now. */
  async syncConnections(id: string) {
    await this.assertExists(id);
    return this.scheduler.syncConnections(id);
  }

  /** Admin: re-spread this campaign's pending invites across working days (fix pile-ups). */
  async respaceSchedule(id: string) {
    await this.assertExists(id);
    return this.scheduler.respaceCampaign(id);
  }

  /** Admin: at-a-glance daily-pull schedule status (today/next planned vs cap + pending). */
  async scheduleStatus(id: string) {
    return this.scheduler.scheduleStatus(id);
  }

  /**
   * Suspend a client's LinkedIn outreach — pause every RUNNING campaign (cancels its
   * scheduled actions via the scheduler). Called when a client's plan validity expires
   * or an admin deactivates the client, mirroring the email cohort behaviour.
   */
  async pauseAllForClient(clientId: string): Promise<number> {
    const running = await this.prisma.liCampaign.findMany({
      where: { clientId, status: LiCampaignStatus.RUNNING },
      select: { id: true },
    });
    for (const c of running) await this.setStatus(c.id, LiCampaignStatus.PAUSED);
    // Label them, so a later renewal resumes exactly these and nothing else.
    if (running.length) {
      await this.prisma.liCampaign.updateMany({
        where: { id: { in: running.map((c) => c.id) } },
        data: { pausedReason: CLIENT_SUSPENDED_REASON },
      });
    }
    return running.length;
  }

  /**
   * Resume a client's campaigns when the client is reactivated / renewed.
   *
   * Only campaigns the suspension stopped (or unlabelled ones, which covers anything
   * paused before labelling existed). Campaigns the engine paused for its own reasons —
   * low acceptance, a LinkedIn checkpoint, a removed account — stay paused: a renewal
   * says nothing about whether those problems are fixed.
   */
  async resumeAllForClient(clientId: string): Promise<number> {
    const paused = await this.prisma.liCampaign.findMany({
      where: {
        clientId,
        status: LiCampaignStatus.PAUSED,
        linkedInAccountId: { not: null },
        OR: [{ pausedReason: null }, { pausedReason: CLIENT_SUSPENDED_REASON }],
      },
      select: { id: true },
    });
    let resumed = 0;
    for (const c of paused) {
      // One campaign failing to start must not strand the rest.
      try { await this.setStatus(c.id, LiCampaignStatus.RUNNING); resumed++; }
      catch (e) { this.logger.warn(`Resume ${c.id} after client reactivation failed: ${(e as Error).message}`); }
    }
    return resumed;
  }

  /** Tenant-wide emergency control across every client's LinkedIn campaigns. */
  async emergencyControl(tenantId: string, action: 'pause' | 'resume' | 'stop'): Promise<{ affected: number }> {
    const from = action === 'resume'
      ? [LiCampaignStatus.PAUSED]
      : action === 'pause'
        ? [LiCampaignStatus.RUNNING]
        : [LiCampaignStatus.RUNNING, LiCampaignStatus.PAUSED]; // stop
    const to = action === 'resume' ? LiCampaignStatus.RUNNING
      : action === 'pause' ? LiCampaignStatus.PAUSED
        : LiCampaignStatus.ARCHIVED;
    const campaigns = await this.prisma.liCampaign.findMany({
      where: { tenantId, status: { in: from } },
      select: { id: true },
    });
    for (const c of campaigns) await this.setStatus(c.id, to);
    return { affected: campaigns.length };
  }

  /** Resolve a client name/company/invoice search to matching client ids in the tenant. */
  private async clientIdsForSearch(tenantId: string, search?: string): Promise<string[] | undefined> {
    const q = search?.trim();
    if (!q) return undefined;
    const ci = { contains: q, mode: 'insensitive' as const };
    const clients = await this.prisma.client.findMany({
      where: { tenantId, OR: [{ name: ci }, { productCategory: ci }, { invoiceNo: ci }] },
      select: { id: true },
    });
    return clients.map((c) => c.id);
  }

  private async clientMap(clientIds: string[]) {
    const clients = await this.prisma.client.findMany({
      where: { id: { in: [...new Set(clientIds)] } },
      select: { id: true, name: true, productCategory: true, invoiceNo: true },
    });
    return new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, company: c.productCategory, invoice: c.invoiceNo }]));
  }

  /** Admin cross-client campaign schedule board. */
  async globalSchedule(tenantId: string, opts: { clientSearch?: string; status?: LiCampaignStatus; range?: string; from?: string; to?: string; page?: number; pageSize?: number; clientId?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const clientIds = await this.clientIdsForSearch(tenantId, opts.clientSearch);
    if (clientIds && clientIds.length === 0) return { items: [], total: 0, page, pageSize };

    const where: Prisma.LiCampaignWhereInput = {
      tenantId,
      status: opts.status ?? { not: LiCampaignStatus.DELETED },
      ...(opts.clientId ? { clientId: opts.clientId } : clientIds ? { clientId: { in: clientIds } } : {}),
    };
    // Load all matching campaigns, then annotate each with its next scheduled send
    // and apply the date-window filter — mirrors the email cohort agenda.
    const campaigns = await this.prisma.liCampaign.findMany({
      where,
      include: { linkedInAccount: { select: { fullName: true } }, _count: { select: { leads: true } } },
    });

    // Earliest upcoming scheduled action per campaign (via lead → campaign).
    const now = new Date();
    // Any not-yet-done action is the campaign's "next send" — including one whose
    // runAt is already due/overdue (worker mid-spread or slightly behind); those
    // are clamped to "now" for the date-window filter below.
    const actions = campaigns.length
      ? await this.prisma.liScheduledAction.findMany({
          where: { status: { in: ['PENDING', 'QUEUED'] }, lead: { campaignId: { in: campaigns.map((c) => c.id) } } },
          select: { runAt: true, type: true, leadId: true, lead: { select: { campaignId: true } } },
          orderBy: { runAt: 'asc' },
        })
      : [];
    // Only RUNNING campaigns have live upcoming sends. A PAUSED/stopped campaign's
    // actions are frozen (won't fire), so exclude them from next-send/forecast/totals.
    const runningIds = new Set(campaigns.filter((c) => c.status === LiCampaignStatus.RUNNING).map((c) => c.id));
    const liveActions = actions.filter((a) => runningIds.has(a.lead.campaignId));
    const nextByCampaign = new Map<string, Date>();
    for (const a of liveActions) { const cid = a.lead.campaignId; if (!nextByCampaign.has(cid)) nextByCampaign.set(cid, a.runAt); }

    // Day-by-day forecast per campaign (exact, from the scheduled actions): how many
    // connection invites / messages go out on each date, and to how many distinct leads.
    const tzByCampaign = new Map(campaigns.map((c) => [c.id, c.timezone || 'Asia/Kolkata']));
    const dayStr = (d: Date, tz: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const forecast = new Map<string, Map<string, { connections: number; messages: number; leads: Set<string> }>>();
    for (const a of liveActions) {
      if (a.type !== 'SEND_CONNECTION' && a.type !== 'SEND_MESSAGE') continue;
      const cid = a.lead.campaignId;
      const day = dayStr(a.runAt.getTime() < now.getTime() ? now : a.runAt, tzByCampaign.get(cid) ?? 'Asia/Kolkata');
      if (!forecast.has(cid)) forecast.set(cid, new Map());
      const byDay = forecast.get(cid)!;
      const slot = byDay.get(day) ?? { connections: 0, messages: 0, leads: new Set<string>() };
      if (a.type === 'SEND_CONNECTION') slot.connections++;
      else slot.messages++;
      slot.leads.add(a.leadId);
      byDay.set(day, slot);
    }
    const forecastFor = (cid: string) =>
      [...(forecast.get(cid)?.entries() ?? [])]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(0, 14)
        .map(([date, v]) => ({ date, connections: v.connections, messages: v.messages, leads: v.leads.size }));

    // Date-window filter on the next send.
    const range = opts.range ?? 'all';
    let winFrom: Date | null = null; let winTo: Date | null = null;
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    if (range === 'today') { winFrom = startOfToday; winTo = new Date(startOfToday.getTime() + 864e5); }
    else if (range === 'week') { winFrom = startOfToday; winTo = new Date(startOfToday.getTime() + 7 * 864e5); }
    else if (range === 'custom' && opts.from) { winFrom = new Date(opts.from); winTo = opts.to ? new Date(`${opts.to}T23:59:59`) : new Date(winFrom.getTime() + 864e5); }
    // 'all' / 'upcoming' → any future send (or no window).

    // A due/overdue send counts as "now" for windowing (so a running campaign
    // whose next action is already due still shows under Today / Next 7 days).
    const eff = (d: Date) => (d.getTime() < now.getTime() ? now : d);
    let annotated = campaigns.map((c) => ({ c, nextSendAt: nextByCampaign.get(c.id) ?? null }));
    if (range === 'today' || range === 'week' || range === 'custom') {
      annotated = annotated.filter((x) => x.nextSendAt && eff(x.nextSendAt) >= winFrom! && eff(x.nextSendAt) < winTo!);
    } else if (range === 'upcoming') {
      annotated = annotated.filter((x) => !!x.nextSendAt);
    }
    // Soonest send first (nulls last), then newest.
    annotated.sort((a, b) => {
      const av = a.nextSendAt?.getTime() ?? Infinity; const bv = b.nextSendAt?.getTime() ?? Infinity;
      if (av !== bv) return av - bv;
      return b.c.createdAt.getTime() - a.c.createdAt.getTime();
    });

    const total = annotated.length;
    const pageRows = annotated.slice((page - 1) * pageSize, page * pageSize);
    const cmap = await this.clientMap(pageRows.map((x) => x.c.clientId));
    const items = pageRows.map(({ c, nextSendAt }) => ({
      id: c.id, name: c.name, status: c.status, clientId: c.clientId,
      timezone: c.timezone, run247: c.run247, workStartHour: c.workStartHour, workEndHour: c.workEndHour,
      workDays: c.workDays, dailyConnectionLimit: c.dailyConnectionLimit, dailyMessageLimit: c.dailyMessageLimit,
      warmupEnabled: c.warmupEnabled, dripEnabled: c.dripEnabled,
      seat: c.linkedInAccount?.fullName ?? null, leads: c._count.leads,
      nextSendAt: nextSendAt ?? null,
      forecast: forecastFor(c.id),
      client: cmap.get(c.clientId) ?? null,
    }));

    // Tenant-wide daily totals across ALL matching campaigns (every page), so the
    // board shows "on <date>, N invites + M messages to K leads across C campaigns".
    const totalsByDay = new Map<string, { connections: number; messages: number; leads: Set<string>; campaigns: Set<string> }>();
    for (const a of liveActions) {
      if (a.type !== 'SEND_CONNECTION' && a.type !== 'SEND_MESSAGE') continue;
      const cid = a.lead.campaignId;
      const day = dayStr(a.runAt.getTime() < now.getTime() ? now : a.runAt, tzByCampaign.get(cid) ?? 'Asia/Kolkata');
      const t = totalsByDay.get(day) ?? { connections: 0, messages: 0, leads: new Set<string>(), campaigns: new Set<string>() };
      if (a.type === 'SEND_CONNECTION') t.connections++;
      else t.messages++;
      t.leads.add(a.leadId);
      t.campaigns.add(cid);
      totalsByDay.set(day, t);
    }
    const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
    const dailyTotals = [...totalsByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, 14)
      .map(([date, v]) => ({
        date,
        connections: v.connections,
        messages: v.messages,
        leads: v.leads.size,
        campaigns: v.campaigns.size,
        // When a day's sends all belong to one campaign, name it; else it's a mix.
        campaignName: v.campaigns.size === 1 ? (nameById.get([...v.campaigns][0]!) ?? null) : null,
      }));

    return { items, total, page, pageSize, dailyTotals };
  }

  /** Admin cross-client leads view (leads sourced via drip / import / audience). */
  async globalLeads(tenantId: string, opts: { clientSearch?: string; status?: LiLeadStatus; page?: number; pageSize?: number; all?: boolean; step?: number; sentFrom?: string; sentTo?: string }) {
    // `all` (CSV export) returns every matching row, capped for safety.
    const page = opts.all ? 1 : Math.max(1, opts.page ?? 1);
    const pageSize = opts.all ? 10000 : Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const clientIds = await this.clientIdsForSearch(tenantId, opts.clientSearch);
    if (clientIds && clientIds.length === 0) return { items: [], total: 0, page, pageSize };

    const sentRange = dateRange(opts.sentFrom, opts.sentTo);
    const where: Prisma.LiLeadWhereInput = {
      campaign: { tenantId, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.step != null && !Number.isNaN(opts.step) ? { currentStep: opts.step } : {}),
      ...(sentRange ? { lastActionAt: sentRange } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.liLead.count({ where }),
      this.prisma.liLead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, fullName: true, title: true, company: true, profileUrl: true, status: true, currentStep: true, createdAt: true, lastActionAt: true, connectionsCount: true,
          campaign: { select: { id: true, name: true, status: true, clientId: true } },
        },
      }),
    ]);
    const cmap = await this.clientMap(rows.map((r) => r.campaign.clientId));
    const items = rows.map((l) => ({
      id: l.id, fullName: l.fullName, title: l.title, company: l.company, profileUrl: l.profileUrl,
      status: l.status, currentStep: l.currentStep, createdAt: l.createdAt, lastActionAt: l.lastActionAt, connectionsCount: l.connectionsCount,
      campaign: { id: l.campaign.id, name: l.campaign.name, status: l.campaign.status },
      client: cmap.get(l.campaign.clientId) ?? null,
    }));
    return { items, total, page, pageSize };
  }

  /**
   * Cross-client LinkedIn activity log: every scheduled outreach action (connection
   * requests + follow-up messages) across all campaigns, with its step, status, planned
   * and actual send time. Read-only over our own DB — no provider calls. Defaults to
   * today's activity (by scheduled time) when no date range is given.
   */
  /** How many leads were auto-excluded because their profile link was corrupted/unresolvable
   *  (so they need re-importing). Distinct leads across the tenant. */
  async excludedCorruptedCount(tenantId: string): Promise<{ count: number; byClient: { clientId: string; name: string; count: number }[] }> {
    const rows = await this.prisma.liScheduledAction.findMany({
      where: {
        status: LiScheduledActionStatus.CANCELLED,
        lastError: { contains: 'corrupted profile link' },
        lead: { campaign: { tenantId } },
      },
      select: { leadId: true, lead: { select: { campaign: { select: { clientId: true } } } } },
      distinct: ['leadId'],
    });
    const perClient = new Map<string, number>();
    for (const r of rows) {
      const cid = r.lead.campaign.clientId;
      perClient.set(cid, (perClient.get(cid) ?? 0) + 1);
    }
    const cmap = await this.clientMap([...perClient.keys()]);
    const byClient = [...perClient.entries()]
      .map(([clientId, count]) => ({ clientId, name: cmap.get(clientId)?.name ?? 'Unknown', count }))
      .sort((a, b) => b.count - a.count);
    return { count: rows.length, byClient };
  }

  async globalActions(tenantId: string, opts: {
    clientSearch?: string; status?: LiScheduledActionStatus; type?: LiScheduledActionType;
    step?: number; from?: string; to?: string; page?: number; pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const clientIds = await this.clientIdsForSearch(tenantId, opts.clientSearch);
    if (clientIds && clientIds.length === 0) return { items: [], total: 0, page, pageSize };

    // Default view = today's activity (planned or sent today), unless a range is given.
    const range = dateRange(opts.from, opts.to) ?? defaultTodayRange();
    // Only the meaningful outreach steps — acceptance polls / completions are internal noise.
    const typeFilter = opts.type
      ? { type: opts.type }
      : { type: { in: [LiScheduledActionType.SEND_CONNECTION, LiScheduledActionType.SEND_MESSAGE] } };
    const where: Prisma.LiScheduledActionWhereInput = {
      lead: { campaign: { tenantId, ...(clientIds ? { clientId: { in: clientIds } } : {}) } },
      ...typeFilter,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.step != null && !Number.isNaN(opts.step) ? { stepOrder: opts.step } : {}),
      ...(range ? { runAt: range } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.liScheduledAction.count({ where }),
      this.prisma.liScheduledAction.findMany({
        where, orderBy: { runAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, type: true, status: true, stepOrder: true, runAt: true, updatedAt: true, lastError: true,
          lead: { select: { id: true, fullName: true, status: true, lastReplyAt: true, currentStep: true, profileUrl: true, connectionsCount: true, campaign: { select: { id: true, name: true, clientId: true } } } },
        },
      }),
    ]);
    const cmap = await this.clientMap(rows.map((r) => r.lead.campaign.clientId));
    const items = rows.map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      stepOrder: a.stepOrder,
      runAt: a.runAt,
      doneAt: a.status === LiScheduledActionStatus.DONE ? a.updatedAt : null,
      error: a.lastError,
      lead: { id: a.lead.id, fullName: a.lead.fullName, status: a.lead.status, lastReplyAt: a.lead.lastReplyAt, currentStep: a.lead.currentStep, profileUrl: a.lead.profileUrl, connectionsCount: a.lead.connectionsCount },
      campaign: { id: a.lead.campaign.id, name: a.lead.campaign.name },
      client: cmap.get(a.lead.campaign.clientId) ?? null,
    }));
    return { items, total, page, pageSize };
  }

  /**
   * Per-lead action timeline — when each step was actually sent. Powers the "Log"
   * button. Shows the connection request, each follow-up message, and the moment
   * the connection was accepted; internal acceptance polls are omitted as noise.
   */
  async leadLog(campaignId: string, leadId: string) {
    const lead = await this.prisma.liLead.findFirst({
      where: { id: leadId, campaignId },
      select: { id: true, fullName: true, status: true, currentStep: true, connectedAt: true, lastReplyAt: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Map a step order to a human label ("Connection request" / "Follow-up N").
    const steps = await this.prisma.liSequenceStep.findMany({
      where: { campaignId }, orderBy: { order: 'asc' }, select: { order: true, type: true },
    });
    const messageOrders = steps.filter((s) => s.type === 'MESSAGE').map((s) => s.order);
    const labelFor = (type: string, stepOrder: number | null): string => {
      if (type === 'SEND_CONNECTION') return 'Connection request';
      if (type === 'SEND_MESSAGE') {
        const idx = stepOrder != null ? messageOrders.indexOf(stepOrder) : -1;
        return idx >= 0 ? `Follow-up ${idx + 1}` : 'Message';
      }
      return type;
    };

    const actions = await this.prisma.liScheduledAction.findMany({
      where: { leadId, type: { in: ['SEND_CONNECTION', 'SEND_MESSAGE'] } },
      orderBy: { runAt: 'asc' },
      select: { type: true, stepOrder: true, status: true, runAt: true, updatedAt: true, lastError: true },
    });

    const entries = actions.map((a) => ({
      label: labelFor(a.type, a.stepOrder),
      status: a.status, // DONE = sent · PENDING/QUEUED/RUNNING = scheduled · FAILED · CANCELLED
      // When it happened: completion time for a finished action, else the due time.
      at: a.status === 'DONE' ? a.updatedAt : a.runAt,
      scheduledFor: a.runAt,
      error: a.lastError,
    }));
    // Fold in the acceptance moment so the timeline reads naturally.
    if (lead.connectedAt) entries.push({ label: 'Connection accepted', status: 'DONE', at: lead.connectedAt, scheduledFor: lead.connectedAt, error: null });
    if (lead.lastReplyAt) entries.push({ label: 'Reply received', status: 'DONE', at: lead.lastReplyAt, scheduledFor: lead.lastReplyAt, error: null });
    entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return { lead: { id: lead.id, fullName: lead.fullName, status: lead.status, currentStep: lead.currentStep }, entries };
  }

  /**
   * Point a campaign at a (new) LinkedIn account — typically after its old account was
   * removed, which pauses and detaches the campaign but keeps its sequence, audience,
   * schedule and leads. Resuming afterwards carries on from where it stopped.
   */
  async attachAccount(id: string, linkedInAccountId: string) {
    if (!linkedInAccountId || typeof linkedInAccountId !== 'string') {
      throw new BadRequestException('linkedInAccountId is required');
    }
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id },
      select: { clientId: true, status: true, linkedInAccountId: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status === LiCampaignStatus.RUNNING) {
      throw new BadRequestException('Pause the campaign before changing its LinkedIn account');
    }
    const account = await this.prisma.linkedInAccount.findFirst({
      where: { id: linkedInAccountId, clientId: campaign.clientId },
      select: { id: true },
    });
    if (!account) throw new BadRequestException('That LinkedIn account does not belong to this client');
    if (campaign.linkedInAccountId === account.id) return this.get(id);

    await this.prisma.$transaction([
      this.prisma.liCampaign.update({ where: { id }, data: { linkedInAccountId: account.id, pausedReason: null } }),
      // Invitation and chat ids are scoped to the connection they were created on, so
      // after a switch they point at nothing. Clearing them is lossless — messages stay
      // stored locally — and the sweep re-discovers live ids by member on the new account.
      this.prisma.liLead.updateMany({ where: { campaignId: id }, data: { unipileInvitationId: null } }),
      this.prisma.liConversation.updateMany({ where: { lead: { campaignId: id } }, data: { unipileChatId: null } }),
    ]);
    return this.get(id);
  }

  private async assertExists(id: string) {
    const n = await this.prisma.liCampaign.count({ where: { id } });
    if (!n) throw new NotFoundException('Campaign not found');
  }
}

/**
 * Personalisation tokens are single-braced ({first_name}). Authors often type the
 * handlebars form {{first_name}} — which would render as "{Rahul}" because only the
 * inner braces get substituted. Collapse it on save so what's stored is correct.
 */
function normalizeTokens(text?: string | null): string | null | undefined {
  if (text == null) return text;
  return text.replace(/\{\{\s*(first_name|last_name|company|title)\s*\}\}/gi, '{$1}');
}

/** Inclusive date range → Prisma DateTime filter (end date covers the whole day). */
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | null {
  const r: Prisma.DateTimeFilter = {};
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) r.gte = d; }
  if (to) { const d = new Date(to); if (!Number.isNaN(d.getTime())) r.lte = new Date(d.getTime() + 86_400_000 - 1); }
  return r.gte || r.lte ? r : null;
}

/** Whole of the current (server-local) day → Prisma DateTime filter. */
function defaultTodayRange(): Prisma.DateTimeFilter {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return { gte: start, lte: new Date(start.getTime() + 86_400_000 - 1) };
}
