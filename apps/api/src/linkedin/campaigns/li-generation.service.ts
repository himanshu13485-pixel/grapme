import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { LiCreditReason, LiLeadStatus, LiOutreachType, LiStepType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LiAiService } from '../ai/ai.service';
import { AiService } from '../../ai/ai.service';
import { LiCampaignsService } from './li-campaigns.service';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { normalizeProfileUrl } from '../scheduler/li-queue.constants';
import { UpsertLiAudienceDto, LiSequenceStepDto } from './dto/campaign.dto';

type Content = Record<string, any>;
const COMPANY_SIZES = ['Startup (1-10)', 'Small (11-50)', 'Medium (51-200)', 'Large (201-1000)', 'Enterprise (1000+)'];

@Injectable()
export class LiGenerationService {
  private readonly logger = new Logger(LiGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: LiAiService,
    private readonly openai: AiService,
    private readonly campaigns: LiCampaignsService,
    private readonly subs: LinkedInSubscriptionService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {}

  /**
   * Unified AI JSON generation: prefer the tenant's OpenAI key (set in Admin →
   * My Account), fall back to the server Claude key, then to null so the caller
   * uses its canned fallback. Never throws — generation degrades gracefully.
   */
  private async aiJson<T>(tenantId: string, system: string, user: string): Promise<T | null> {
    if (await this.openai.tenantConfigured(tenantId).catch(() => false)) {
      try { return await this.openai.generateJsonForTenant<T>(tenantId, system, user); }
      catch (e) { this.logger.warn(`OpenAI generation failed, falling back: ${e}`); }
    }
    if (this.ai.configured) {
      try { return await this.ai.generateJson<T>(system, user); }
      catch (e) { this.logger.warn(`Claude generation failed: ${e}`); }
    }
    return null;
  }

  // ── Audience-based lead sourcing (LinkedIn search → Target Audience) ──────
  private leadSlug(url?: string | null): string | null {
    const m = (url ?? '').match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }
  private nameFromSlug(slug: string): string {
    return slug.replace(/-[a-z0-9]{6,}$/i, '').split('-').filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || slug;
  }
  /**
   * Turn the Target Audience into a SET of focused search queries rather than one
   * muddy keyword blob. LinkedIn's classic people-search is a keyword match, so a
   * single query stuffed with every field returns noise; a matrix of
   * "role + industry/company + location" queries is far more accurate and uses far
   * more of the audience. Exclude keywords are appended as `-term` (classic NOT).
   */
  private buildQueries(spec: any): string[] {
    if (!spec) return [];
    const arr = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];

    // Who to reach (the "role" slot): job titles → else seniorities/departments →
    // else person keywords (e.g. "procurement", "sourcing"). These describe the person.
    const titles = arr(spec.jobTitles);
    const roles =
      titles.length ? titles
        : [...arr(spec.seniorities), ...arr(spec.departments)].length ? [...arr(spec.seniorities), ...arr(spec.departments)]
          : arr(spec.personKeywordsInclude);
    // Where they work (the "context" slot): industries + company keywords.
    const contexts = [...arr(spec.industries), ...arr(spec.companyKeywordsInclude)];
    // Geo axis to cycle: every country/city becomes its own queries so all your
    // target locations get sourced (not just the first one).
    const geos = [...arr(spec.countries), ...arr(spec.cities)];
    const compose = (...parts: (string | undefined)[]) =>
      parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    // CRITICAL: keep each query SHORT (role + context + geo, ~3–4 words). LinkedIn's
    // classic search is an AND match, so stuffing every keyword in one query matches
    // nobody. We rotate the values across many small queries — never concatenate them.
    const roleList = roles.length ? roles.slice(0, 6) : [''];
    const ctxList = contexts.length ? contexts.slice(0, 4) : [''];
    const geoList = geos.length ? geos.slice(0, 6) : [''];
    if (!roleList[0] && !ctxList[0] && !geoList[0]) return [];

    // Cap the TOTAL at 12 queries so a source run stays a handful of Unipile calls,
    // and split evenly per geo so every location gets covered (with varied roles).
    const CAP = 12;
    const perGeo = Math.max(1, Math.floor(CAP / geoList.length));
    const queries = new Set<string>();
    for (let g = 0; g < geoList.length && queries.size < CAP; g++) {
      for (let k = 0; k < perGeo && queries.size < CAP; k++) {
        const q = compose(roleList[(g * perGeo + k) % roleList.length], ctxList[k % ctxList.length], geoList[g]);
        if (q) queries.add(q);
      }
    }
    // Fill any leftover slots (from rounding/dupes) with more role×context×geo combos.
    const total = roleList.length * ctxList.length * geoList.length;
    for (let i = 0; queries.size < CAP && i < total; i++) {
      const q = compose(
        roleList[i % roleList.length],
        ctxList[Math.floor(i / roleList.length) % ctxList.length],
        geoList[Math.floor(i / (roleList.length * ctxList.length)) % geoList.length],
      );
      if (q) queries.add(q);
    }
    return [...queries].slice(0, CAP);
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
    const queries = this.buildQueries(campaign.audienceSpec);
    if (queries.length === 0) throw new BadRequestException('Add audience criteria (job titles, industries, or keywords) before sourcing leads.');
    const keywords = queries.join(' | '); // for the response + logs

    // Optional per-client credit metering: 1 credit PER lead added. Cap sourcing to
    // the affordable count so we never source more than the client can pay for.
    const client = await this.prisma.client.findUnique({ where: { id: campaign.clientId }, select: { linkedInCreditMetering: true } });
    const metered = !!client?.linkedInCreditMetering;
    let balance = Infinity;
    if (metered) {
      const sub = await this.subs.getOrCreate(campaign.tenantId, campaign.clientId);
      balance = sub.creditsBalance;
      if (balance < 1) throw new BadRequestException('Insufficient LinkedIn credits to source leads.');
    }

    const cap = Math.min(100, Math.max(1, Math.min(limit, balance)));
    const existing = await this.prisma.liLead.findMany({ where: { campaignId }, select: { profileUrl: true } });
    const seen = new Set(existing.map((l) => this.leadSlug(l.profileUrl)).filter(Boolean) as string[]);

    // Run each focused query in turn (paginating a few pages each), merging + deduping
    // the people until we hit the cap. This spreads sourcing across the audience matrix
    // instead of one blurry query, so the leads are much better targeted.
    const rows: Prisma.LiLeadCreateManyInput[] = [];
    queryLoop:
    for (const q of queries) {
      let cursor: string | undefined;
      for (let page = 0; page < 6 && rows.length < cap; page++) {
        const res = await this.provider.searchPeople({ accountId: account.unipileAccountId, keywords: q, cursor });
        for (const p of res.people) {
          const s = this.leadSlug(p.profileUrl);
          if (!s || seen.has(s)) continue;
          seen.add(s);
          rows.push({
            campaignId, fullName: p.fullName ?? this.nameFromSlug(s),
            firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined,
            title: p.title ?? undefined, company: p.company ?? undefined, location: p.location ?? undefined,
            profileUrl: normalizeProfileUrl(p.profileUrl), status: LiLeadStatus.PENDING, currentStep: 0,
          });
          if (rows.length >= cap) break queryLoop;
        }
        if (!res.cursor || res.people.length === 0) break; // exhausted this query → next
        cursor = res.cursor;
      }
    }
    this.logger.log(`Campaign ${campaignId}: sourced ${rows.length}/${cap} across ${queries.length} queries → [${keywords}]`);
    if (rows.length === 0) return { sourced: 0, keywords, creditsCharged: 0 };
    const r = await this.prisma.liLead.createMany({ data: rows, skipDuplicates: true });

    let creditsCharged = 0;
    if (metered && r.count > 0) {
      creditsCharged = Math.min(r.count, balance);
      await this.subs.debit(campaign.tenantId, campaign.clientId, creditsCharged, LiCreditReason.LEAD_SOURCING, { refType: 'LiCampaign', refId: campaignId });
    }
    if (r.count > 0) await this.campaigns.enqueueNewLeads(campaignId).catch(() => undefined);
    return { sourced: r.count, keywords, creditsCharged };
  }

  /**
   * Bulk-import the seat's own 1st-degree connections into the campaign's audience,
   * deduped against the current leads. They come in already-connected (connectedAt set)
   * so a Direct-Messages campaign reaches them without an invite. Charges 1 credit per
   * run when the client's LinkedIn credit metering is on (same as search sourcing).
   */
  async importConnections(campaignId: string, limit?: number) {
    const campaign = await this.prisma.liCampaign.findUnique({ where: { id: campaignId }, include: { linkedInAccount: true } });
    if (!campaign) throw new BadRequestException('Campaign not found');
    const account = campaign.linkedInAccount;
    if (!account?.unipileAccountId || account.status !== 'CONNECTED') {
      throw new BadRequestException('This campaign needs a CONNECTED LinkedIn account before importing connections.');
    }

    const client = await this.prisma.client.findUnique({ where: { id: campaign.clientId }, select: { linkedInCreditMetering: true } });
    const metered = !!client?.linkedInCreditMetering;
    let balance = Infinity;
    if (metered) {
      const sub = await this.subs.getOrCreate(campaign.tenantId, campaign.clientId);
      balance = sub.creditsBalance;
      if (balance < 1) throw new BadRequestException('Insufficient LinkedIn credits to import connections.');
    }

    // Import up to `limit` new connections per run (default 500), capped to the credit
    // balance when metered — the daily send cap governs actual outreach pace.
    const cap = Math.min(2000, Math.max(1, Math.min(limit ?? 500, balance)));
    const existing = await this.prisma.liLead.findMany({ where: { campaignId }, select: { profileUrl: true, unipileMemberId: true } });
    const seenSlugs = new Set(existing.map((l) => this.leadSlug(l.profileUrl)).filter(Boolean) as string[]);
    const seenMembers = new Set(existing.map((l) => l.unipileMemberId).filter(Boolean) as string[]);

    const rows: Prisma.LiLeadCreateManyInput[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40 && rows.length < cap; page++) {
      const res = await this.provider.listRelations({ accountId: account.unipileAccountId, cursor });
      for (const p of res.people) {
        if (p.memberId && seenMembers.has(p.memberId)) continue;
        const slug = this.leadSlug(p.profileUrl);
        if (slug && seenSlugs.has(slug)) continue;
        if (p.memberId) seenMembers.add(p.memberId);
        if (slug) seenSlugs.add(slug);
        rows.push({
          campaignId,
          fullName: p.fullName ?? (slug ? this.nameFromSlug(slug) : 'LinkedIn member'),
          firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined,
          title: p.title ?? undefined, company: p.company ?? undefined, location: p.location ?? undefined,
          profileUrl: normalizeProfileUrl(p.profileUrl) ?? undefined, unipileMemberId: p.memberId ?? undefined, avatarUrl: p.avatarUrl ?? undefined,
          // Already a 1st-degree connection: mark connectedAt; keep status PENDING so the
          // engine schedules the first (direct) message via startCampaign.
          status: LiLeadStatus.PENDING, currentStep: 0, connectedAt: new Date(),
        });
        if (rows.length >= cap) break;
      }
      if (!res.cursor || res.people.length === 0) break;
      cursor = res.cursor;
    }
    if (rows.length === 0) return { imported: 0, creditsCharged: 0 };
    const r = await this.prisma.liLead.createMany({ data: rows, skipDuplicates: true });

    let creditsCharged = 0;
    if (metered && r.count > 0) {
      creditsCharged = Math.min(r.count, balance);
      await this.subs.debit(campaign.tenantId, campaign.clientId, creditsCharged, LiCreditReason.LEAD_SOURCING, { refType: 'LiCampaign', refId: campaignId });
    }
    if (r.count > 0) await this.campaigns.enqueueNewLeads(campaignId).catch(() => undefined);
    return { imported: r.count, creditsCharged };
  }

  async generateAudience(campaignId: string) {
    const { campaign, business, strategy } = await this.loadKnowledge(campaignId);
    const system = 'You are a B2B LinkedIn targeting expert. Respond with ONLY a JSON object.';
    const user =
      `BUSINESS PROFILE:\n${JSON.stringify(business)}\n\nSTRATEGY:\n${JSON.stringify(strategy)}\n\n` +
      `Return JSON with keys: countries[], cities[], industries[], companySizes[], departments[], ` +
      `jobTitles[], seniorities[], companyKeywordsInclude[], companyKeywordsExclude[], ` +
      `personKeywordsInclude[], personKeywordsExclude[]. ` +
      `companySizes MUST be from: ${JSON.stringify(COMPANY_SIZES)}. Keep each array <=8.`;
    const spec = (await this.aiJson<UpsertLiAudienceDto>(campaign.tenantId, system, user)) ?? this.fallbackAudience(business, strategy);
    return this.campaigns.upsertAudience(campaignId, spec);
  }

  async generateMessages(campaignId: string, opts: { outreachType?: LiOutreachType; followUps?: number; variants?: number }) {
    const { campaign, business, strategy } = await this.loadKnowledge(campaignId);
    const outreachType = opts.outreachType ?? campaign.outreachType;
    const direct = outreachType === LiOutreachType.DIRECT_MESSAGES;
    const followUps = Math.min(5, Math.max(1, opts.followUps ?? 2));
    // How many wordings per step: 1 = single body, up to 3 = body + 2 alternates.
    const variants = Math.min(3, Math.max(1, opts.variants ?? 1));
    const extra = variants - 1;

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
      (extra > 0
        ? `Also give each MESSAGE (and the CONNECTION_REQUEST note) a "variants" array of ${extra} ALTERNATE wording(s) that say the SAME thing differently (for human-like variation, never duplicates of "body"). `
        : '') +
      `Use waitHours like 24, 48, 72. Keep bodies under 100 words.`;
    const steps: LiSequenceStepDto[] =
      (await this.aiJson<LiSequenceStepDto[]>(campaign.tenantId, system, user)) ??
      this.fallbackMessages(direct, followUps, business, strategy);

    if (opts.outreachType) {
      await this.prisma.liCampaign.update({ where: { id: campaignId }, data: { outreachType } });
    }
    return this.campaigns.updateSequence(campaignId, { steps });
  }

  /**
   * Prompt-based sequence draft for the MANUAL campaign editor — no knowledge
   * profile required (unlike generateMessages). Returns steps for the editor to
   * fill; it does NOT persist anything, so existing campaigns are untouched.
   */
  async draftMessages(
    clientId: string,
    dto: { context?: string; outreachType?: LiOutreachType; followUps?: number; variants?: number },
  ): Promise<{ steps: LiSequenceStepDto[]; source: 'ai' | 'fallback' }> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { tenantId: true, name: true, productCategory: true, serviceType: true },
    });
    if (!client) throw new BadRequestException('Client not found');

    const outreachType = dto.outreachType ?? LiOutreachType.WITH_CONNECTION;
    const direct = outreachType === LiOutreachType.DIRECT_MESSAGES;
    const followUps = Math.min(5, Math.max(1, dto.followUps ?? 2)); // usually 2, up to 3+
    const extra = Math.min(3, Math.max(1, dto.variants ?? 1)) - 1;
    const ctx = (dto.context || '').trim()
      || [client.name, client.productCategory, client.serviceType].filter(Boolean).join(' — ')
      || client.name;

    const system =
      'You are an expert LinkedIn outreach copywriter. Write short, human, non-salesy messages that fit LinkedIn ' +
      '(a connection note must be under 300 characters). Use only these tokens where natural: ' +
      '{first_name} {last_name} {company} {title}. Respond with ONLY a JSON array.';
    const user =
      `CONTEXT: ${ctx}\n\n` +
      `Outreach type: ${outreachType}. Produce a JSON array of steps.\n` +
      (direct
        ? `First step type "MESSAGE" (no connection request). `
        : `First step type "CONNECTION_REQUEST" with a short "note" (<=300 chars). `) +
      `Then ${followUps} steps of type "MESSAGE". Each MESSAGE has: type, waitHours (integer), body. ` +
      (extra > 0
        ? `Also give each MESSAGE (and the CONNECTION_REQUEST note) a "variants" array of ${extra} ALTERNATE wording(s) that say the SAME thing differently (never a duplicate of "body"). `
        : '') +
      `Use waitHours like 2, 24, 48. Keep bodies under 90 words.`;

    const ai = await this.aiJson<LiSequenceStepDto[]>(client.tenantId, system, user);
    if (Array.isArray(ai) && ai.length) return { steps: ai, source: 'ai' };
    return {
      steps: this.fallbackMessages(direct, followUps, { coreProblemSolved: client.productCategory ?? undefined } as Content, {}),
      source: 'fallback',
    };
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
