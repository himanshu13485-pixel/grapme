import { BadRequestException, Injectable } from '@nestjs/common';
import { LiOutreachType, LiStepType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LiAiService } from '../ai/ai.service';
import { LiCampaignsService } from './li-campaigns.service';
import { UpsertLiAudienceDto, LiSequenceStepDto } from './dto/campaign.dto';

type Content = Record<string, any>;
const COMPANY_SIZES = ['Startup (1-10)', 'Small (11-50)', 'Medium (51-200)', 'Large (201-1000)', 'Enterprise (1000+)'];

@Injectable()
export class LiGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: LiAiService,
    private readonly campaigns: LiCampaignsService,
  ) {}

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
