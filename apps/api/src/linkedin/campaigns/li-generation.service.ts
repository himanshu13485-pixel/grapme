import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { LiCreditReason, LiLeadStatus, LiOutreachType, LiStepType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LiAiService } from '../ai/ai.service';
import { LiCampaignsService } from './li-campaigns.service';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { UpsertLiAudienceDto, LiSequenceStepDto } from './dto/campaign.dto';

type Content = Record<string, any>;
const COMPANY_SIZES = ['Startup (1-10)', 'Small (11-50)', 'Medium (51-200)', 'Large (201-1000)', 'Enterprise (1000+)'];

@Injectable()
export class LiGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: LiAiService,
    private readonly campaigns: LiCampaignsService,
    private readonly subs: LinkedInSubscriptionService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {}

  // ── Audience-based lead sourcing (LinkedIn search → Target Audience) ──────
  private leadSlug(url?: string | null): string | null {
    const m = (url ?? '').match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }
  private nameFromSlug(slug: string): string {
    return slug.replace(/-[a-z0-9]{6,}$/i, '').split('-').filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || slug;
  }
  /** Build a LinkedIn keyword query from the campaign's audience spec. */
  private audienceKeywords(spec: any): string {
    if (!spec) return '';
    const parts = [
      ...(spec.jobTitles ?? []).slice(0, 3),
      ...(spec.industries ?? []).slice(0, 2),
      ...(spec.personKeywordsInclude ?? []).slice(0, 2),
      ...(spec.countries ?? []).slice(0, 1),
    ];
    return parts.filter(Boolean).join(' ').trim();
  }

  /** Search LinkedIn for people matching the campaign's audience and add them as PENDING leads. */
  async sourceLeads(campaignId: string, limit = 25) {
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { audienceSpec: true, linkedInAccount: true },
    });
    if (!campaign) throw new BadRequestException('Campaign not found');
    const account = campaign.linkedInAccount;
    if (!account?.unipileAccountId || account.status !== 'CONNECTED') {
      throw new BadRequestException('This campaign needs a CONNECTED LinkedIn account before sourcing leads.');
    }
    const keywords = this.audienceKeywords(campaign.audienceSpec);
    if (!keywords) throw new BadRequestException('Add audience criteria (job titles, industries, or keywords) before sourcing leads.');

    // Optional per-client credit metering: each sourcing run costs 1 credit.
    const client = await this.prisma.client.findUnique({ where: { id: campaign.clientId }, select: { linkedInCreditMetering: true } });
    const metered = !!client?.linkedInCreditMetering;
    if (metered) {
      const sub = await this.subs.getOrCreate(campaign.tenantId, campaign.clientId);
      if (sub.creditsBalance < 1) throw new BadRequestException('Insufficient LinkedIn credits to source leads.');
    }

    const cap = Math.min(100, Math.max(1, limit));
    const existing = await this.prisma.liLead.findMany({ where: { campaignId }, select: { profileUrl: true } });
    const seen = new Set(existing.map((l) => this.leadSlug(l.profileUrl)).filter(Boolean) as string[]);

    const rows: Prisma.LiLeadCreateManyInput[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 12 && rows.length < cap; page++) {
      const res = await this.provider.searchPeople({ accountId: account.unipileAccountId, keywords, cursor });
      for (const p of res.people) {
        const s = this.leadSlug(p.profileUrl);
        if (!s || seen.has(s)) continue;
        seen.add(s);
        rows.push({
          campaignId, fullName: p.fullName ?? this.nameFromSlug(s),
          firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined,
          title: p.title ?? undefined, company: p.company ?? undefined, location: p.location ?? undefined,
          profileUrl: p.profileUrl, status: LiLeadStatus.PENDING, currentStep: 0,
        });
        if (rows.length >= cap) break;
      }
      if (!res.cursor || res.people.length === 0) break;
      cursor = res.cursor;
    }
    if (rows.length === 0) return { sourced: 0, keywords, creditsCharged: 0 };
    const r = await this.prisma.liLead.createMany({ data: rows });

    let creditsCharged = 0;
    if (metered) {
      await this.subs.debit(campaign.tenantId, campaign.clientId, 1, LiCreditReason.LEAD_SOURCING, { refType: 'LiCampaign', refId: campaignId });
      creditsCharged = 1;
    }
    return { sourced: r.count, keywords, creditsCharged };
  }

  async generateAudience(campaignId: string) {
    const { business, strategy } = await this.loadKnowledge(campaignId);
    let spec: UpsertLiAudienceDto;
    if (this.ai.configured) {
      const system = 'You are a B2B LinkedIn targeting expert. Respond with ONLY a JSON object.';
      const user =
        `BUSINESS PROFILE:\n${JSON.stringify(business)}\n\nSTRATEGY:\n${JSON.stringify(strategy)}\n\n` +
        `Return JSON with keys: countries[], cities[], industries[], companySizes[], departments[], ` +
        `jobTitles[], seniorities[], companyKeywordsInclude[], companyKeywordsExclude[], ` +
        `personKeywordsInclude[], personKeywordsExclude[]. ` +
        `companySizes MUST be from: ${JSON.stringify(COMPANY_SIZES)}. Keep each array <=8.`;
      spec = await this.ai.generateJson<UpsertLiAudienceDto>(system, user);
    } else {
      spec = this.fallbackAudience(business, strategy);
    }
    return this.campaigns.upsertAudience(campaignId, spec);
  }

  async generateMessages(campaignId: string, opts: { outreachType?: LiOutreachType; followUps?: number }) {
    const { campaign, business, strategy } = await this.loadKnowledge(campaignId);
    const outreachType = opts.outreachType ?? campaign.outreachType;
    const direct = outreachType === LiOutreachType.DIRECT_MESSAGES;
    const followUps = Math.min(5, Math.max(1, opts.followUps ?? 2));

    let steps: LiSequenceStepDto[];
    if (this.ai.configured) {
      const system =
        'You are an expert LinkedIn outreach copywriter. Write short, human, non-salesy messages. ' +
        'Use only these tokens where natural: {first_name} {last_name} {company} {title}. Respond with ONLY a JSON array.';
      const user =
        `BUSINESS:\n${JSON.stringify(business)}\n\nSTRATEGY:\n${JSON.stringify(strategy)}\n\n` +
        `Outreach type: ${outreachType}. Produce a JSON array of steps.\n` +
        (direct
          ? `First step type "MESSAGE" (no connection request). `
          : `First step type "CONNECTION_REQUEST" with an optional short "note". `) +
        `Then ${followUps} steps of type "MESSAGE". Each MESSAGE has: type, waitHours (integer), body. ` +
        `Use waitHours like 24, 48, 72. Keep bodies under 100 words.`;
      steps = await this.ai.generateJson<LiSequenceStepDto[]>(system, user);
    } else {
      steps = this.fallbackMessages(direct, followUps, business, strategy);
    }

    if (opts.outreachType) {
      await this.prisma.liCampaign.update({ where: { id: campaignId }, data: { outreachType } });
    }
    return this.campaigns.updateSequence(campaignId, { steps });
  }

  private async loadKnowledge(campaignId: string) {
    const campaign = await this.prisma.liCampaign.findUnique({
      where: { id: campaignId },
      include: { businessProfile: true, strategy: true },
    });
    if (!campaign) throw new BadRequestException('Campaign not found');
    if (!campaign.businessProfile) throw new BadRequestException('Link a business profile before AI generation');
    return {
      campaign,
      business: (campaign.businessProfile?.content ?? {}) as Content,
      strategy: (campaign.strategy?.content ?? {}) as Content,
    };
  }

  private fallbackAudience(business: Content, strategy: Content): UpsertLiAudienceDto {
    const loc = String(strategy.targetLocation ?? '');
    return {
      countries: /india/i.test(loc) ? ['India'] : loc ? [loc] : ['India'],
      cities: [],
      industries: business.industry ? [String(business.industry)] : [],
      companySizes: ['Small (11-50)', 'Medium (51-200)'],
      departments: strategy.targetDepartment ? [String(strategy.targetDepartment)] : [],
      jobTitles: strategy.bestClientExample ? [String(strategy.bestClientExample).split(',')[0]] : [],
      seniorities: strategy.targetSeniority ? [String(strategy.targetSeniority)] : [],
      companyKeywordsInclude: [], companyKeywordsExclude: [],
      personKeywordsInclude: [], personKeywordsExclude: [],
    };
  }

  private fallbackMessages(direct: boolean, followUps: number, business: Content, strategy: Content): LiSequenceStepDto[] {
    const pain = String(strategy.painIfNoService ?? 'missing out on results');
    const cta = String(strategy.firstCTA ?? 'a quick chat');
    const problem = String(business.coreProblemSolved ?? 'grow faster');
    const steps: LiSequenceStepDto[] = [];
    if (!direct) steps.push({ type: LiStepType.CONNECTION_REQUEST, waitHours: 0, note: `Hi {first_name}, would love to connect!` });
    steps.push({
      type: LiStepType.MESSAGE, waitHours: direct ? 0 : 2,
      body: `Hi {first_name}, thanks for connecting. We help companies like {company} ${problem}. Open to ${cta}?`,
    });
    const waits = [24, 48, 72, 96, 120];
    for (let i = 1; i < followUps; i++) {
      steps.push({
        type: LiStepType.MESSAGE, waitHours: waits[i - 1] ?? 72,
        body: `Just following up, {first_name} — many teams we work with were previously ${pain}. Worth ${cta}?`,
      });
    }
    return steps;
  }
}
