import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LiKnowledgeKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fieldsFor, computeCompleteness, nextField, KnowledgeField } from './li-knowledge.schema';

type Content = Record<string, unknown>;

@Injectable()
export class LiKnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Business profiles ────────────────────────────────────────────────
  listBusinessProfiles(clientId: string) {
    return this.prisma.liKnowledgeProfile.findMany({
      where: { clientId, kind: LiKnowledgeKind.BUSINESS },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, slug: true, completeness: true, updatedAt: true },
    });
  }

  async createBusinessProfile(tenantId: string, clientId: string, name: string) {
    const profile = await this.prisma.liKnowledgeProfile.create({
      data: { tenantId, clientId, kind: LiKnowledgeKind.BUSINESS, name, slug: this.slugify(name) },
    });
    await this.seedFirstQuestion(profile.id, LiKnowledgeKind.BUSINESS);
    return this.get(profile.id);
  }

  // ── Strategies (children of a business profile) ──────────────────────
  listStrategies(businessProfileId: string) {
    return this.prisma.liKnowledgeProfile.findMany({
      where: { parentId: businessProfileId, kind: LiKnowledgeKind.STRATEGY },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, completeness: true, updatedAt: true },
    });
  }

  async createStrategy(businessProfileId: string, name: string) {
    const parent = await this.prisma.liKnowledgeProfile.findUnique({ where: { id: businessProfileId } });
    if (!parent || parent.kind !== LiKnowledgeKind.BUSINESS) throw new BadRequestException('Parent business profile not found');
    const profile = await this.prisma.liKnowledgeProfile.create({
      data: { tenantId: parent.tenantId, clientId: parent.clientId, kind: LiKnowledgeKind.STRATEGY, parentId: businessProfileId, name, slug: this.slugify(name) },
    });
    await this.seedFirstQuestion(profile.id, LiKnowledgeKind.STRATEGY);
    return this.get(profile.id);
  }

  async get(id: string) {
    const p = await this.prisma.liKnowledgeProfile.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Knowledge profile not found');
    return p;
  }

  /** Structured "Details" view: sections → fields with values + collected flags. */
  async details(id: string) {
    const p = await this.get(id);
    const content = (p.content ?? {}) as Content;
    const fields = fieldsFor(p.kind);
    const sections = new Map<string, { section: string; fields: any[] }>();
    for (const f of fields) {
      if (!sections.has(f.section)) sections.set(f.section, { section: f.section, fields: [] });
      const value = content[f.key];
      sections.get(f.section)!.fields.push({
        key: f.key, label: f.label, value: value ?? null,
        collected: value !== undefined && value !== null && String(value).trim() !== '',
      });
    }
    return { id: p.id, name: p.name, kind: p.kind, completeness: p.completeness, sections: [...sections.values()] };
  }

  async chat(id: string) {
    const p = await this.get(id);
    const messages = await this.prisma.liKnowledgeChatMessage.findMany({ where: { profileId: id }, orderBy: { createdAt: 'asc' } });
    const current = nextField(p.kind, (p.content ?? {}) as Content);
    return { messages, completeness: p.completeness, current: current ? this.fieldPrompt(current) : null, done: !current };
  }

  async answer(id: string, text: string) {
    const p = await this.get(id);
    const content = { ...((p.content ?? {}) as Content) };
    const current = nextField(p.kind, content);
    if (!current) return this.chat(id);

    content[current.key] = text;
    await this.prisma.liKnowledgeChatMessage.create({ data: { profileId: id, role: 'user', content: text, fieldKey: current.key } });

    const completeness = computeCompleteness(p.kind, content);
    await this.prisma.liKnowledgeProfile.update({ where: { id }, data: { content: content as Prisma.InputJsonValue, completeness } });

    const next = nextField(p.kind, content);
    const ack = next
      ? `Got it. ${next.question}`
      : "Perfect — that's everything I need. Your profile is complete and ready to power AI generation.";
    await this.prisma.liKnowledgeChatMessage.create({ data: { profileId: id, role: 'assistant', content: ack } });
    return this.chat(id);
  }

  async setField(id: string, key: string, value: unknown) {
    const p = await this.get(id);
    if (!fieldsFor(p.kind).some((f) => f.key === key)) throw new BadRequestException('Unknown field');
    const content = { ...((p.content ?? {}) as Content), [key]: value };
    const completeness = computeCompleteness(p.kind, content);
    await this.prisma.liKnowledgeProfile.update({ where: { id }, data: { content: content as Prisma.InputJsonValue, completeness } });
    return this.details(id);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.liKnowledgeProfile.delete({ where: { id } });
    return { ok: true };
  }

  /** Client "AI Knowledge %" = average completeness across business profiles. */
  async clientStats(clientId: string) {
    const profiles = await this.prisma.liKnowledgeProfile.findMany({
      where: { clientId, kind: LiKnowledgeKind.BUSINESS },
      select: { completeness: true },
    });
    const count = profiles.length;
    const avg = count ? Math.round(profiles.reduce((s, p) => s + p.completeness, 0) / count) : 0;
    return { profileCount: count, aiKnowledgePct: avg };
  }

  private async seedFirstQuestion(profileId: string, kind: LiKnowledgeKind) {
    const first = fieldsFor(kind)[0];
    const intro = kind === LiKnowledgeKind.BUSINESS
      ? "Hello! I'd be happy to learn about your company. "
      : "Let's define your outreach strategy. ";
    await this.prisma.liKnowledgeChatMessage.create({ data: { profileId, role: 'assistant', content: intro + first.question } });
  }

  private fieldPrompt(f: KnowledgeField) {
    return { key: f.key, label: f.label, type: f.type, question: f.question, options: f.options ?? [] };
  }

  private slugify(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }
}
